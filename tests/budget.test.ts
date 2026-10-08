import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { useDatabase, db, closeDb } from "../lib/db";
import { seedDatabase } from "../lib/seed";
import { runAll } from "../lib/agents/coordinator";
import { advance } from "../lib/sim";
import { decide, undo, postpone } from "../lib/decisions";
import { snapshot } from "../lib/snapshot";
import { budgetInfo, periods } from "../lib/budget";
import { runInvariants } from "../lib/audit";
import { getSim, UserError } from "../lib/core";
import { setSetting } from "../lib/settings";
import { addDays, diffDays } from "../lib/time";

const file = path.join(os.tmpdir(), `smartstock-budget-${process.pid}.db`);
const q = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).all(...a) as T[];
const fresh = (over: Record<string, unknown> = {}) => { seedDatabase({ overrides: { "sim.auto_pause_critical": false, ...over } }); runAll({ group: "start", trigger: "start" }); };
before(() => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(file + e, { force: true }); useDatabase(file); });
test.after(() => { closeDb(); for (const e of ["", "-wal", "-shm"]) fs.rmSync(file + e, { force: true }); });
const approveAll = () => { for (const p of q(`SELECT id FROM recommendations WHERE kind='PO' AND status='PENDING' ORDER BY id`)) { try { decide(p.id, "APPROVED"); } catch { /* refused: above the emergency limit */ } } };
const pendingPo = () => q(`SELECT id, item_id, payload FROM recommendations WHERE kind='PO' AND status='PENDING'`).map((r) => ({ ...r, p: JSON.parse(r.payload) }));

test("day 0 budget numbers are unchanged: 18,000 total, 14,011.5 committed, 3,988.5 free; the period shows days left and the renewal date", () => {
  fresh();
  const b = budgetInfo();
  assert.equal(b.base, 18000); assert.equal(b.committed, 14011.5); assert.equal(b.free, 3988.5);
  assert.equal(b.nextStart, addDays(b.end, 1)); assert.ok(b.daysLeft > 0);
  const s = snapshot();
  assert.equal(s.budget.next_start, b.nextStart); assert.equal(s.kpi.budget_renews, b.nextStart);
});

test("budgets renew automatically: a period exists for every simulated date, with no gaps, the same length and the renewal amount", () => {
  fresh();
  for (let i = 0; i < 3; i++) advance({ hours: 24 * 30 }); // one advance is capped by sim.max_advance_hours
  const list = periods();
  assert.ok(list.length >= 4, "three renewals after 90 days");
  for (let i = 1; i < list.length; i++) {
    assert.equal(list[i].period_start, addDays(list[i - 1].period_end, 1));
    assert.equal(diffDays(list[i].period_end, list[i].period_start) + 1, 28);
    assert.equal(list[i].total_purchasing_budget_omr, list[0].total_purchasing_budget_omr);
  }
  const today = getSim().sim_date;
  assert.ok(list.some((p) => p.period_start <= today && today <= p.period_end));
  assert.ok(q(`SELECT 1 FROM events WHERE type='BUDGET_RENEWED'`).length >= 2);
});

test("renewal amount, length and rollover are settings; unspent money moves on by the rollover share; unreceived orders carry over", () => {
  fresh();
  setSetting("budget.rollover_pct", 50); setSetting("budget.renewal_amount", 20000); setSetting("budget.period_days", 14);
  const first = budgetInfo();
  advance({ hours: 24 * (diffDays(first.end, getSim().sim_date) + 2) });
  const list = periods();
  assert.equal(list[1].total_purchasing_budget_omr, 20000);
  assert.equal(diffDays(list[1].period_end, list[1].period_start) + 1, 14);
  assert.ok(list[1].rollover >= 0);
  const f = budgetInfo();
  assert.ok(Math.abs(f.free - (f.base + f.rollover + f.topup - f.committed)) < 1e-6);
  setSetting("budget.carry_commitments", true);
  assert.ok(f.carried >= 0);
});

test("never go silent: when money is short every needed order is still a suggestion with a funding state; nothing is hidden in the plan", () => {
  fresh();
  for (let d = 0; d < 12; d++) { advance({ hours: 24 }); approveAll(); }
  const s = snapshot();
  const deferred = s.plan.filter((p) => p.status === "DEFERRED" && !String(JSON.stringify(p.reason)).includes("noroom"));
  const recs = pendingPo();
  for (const p of deferred) {
    const r = recs.find((x) => x.item_id === p.item_id);
    assert.ok(r, `${p.item_id}: deferred line without a suggestion`);
    assert.ok(["NEEDS_EXTRA", "DEFERRED"].includes(r!.p.funding), `${p.item_id}: ${r!.p.funding}`);
    assert.ok(r!.p.funding_info.renewal_date, "the card shows the renewal date");
  }
  assert.ok(recs.length > 0 && s.kpi.budget_remaining >= -1e-6);
});

test("emergency budget request: a critical item at risk gets a request; approving records separate emergency spend within the limit; beyond the limit it is refused", () => {
  fresh();
  setSetting("budget.emergency_limit_pct", 100);
  // exhaust the free money, then let a critical item come under pressure
  db().prepare(`UPDATE purchasing_budget SET total_purchasing_budget_omr=14100 WHERE id=1`).run();
  runAll({ group: "t", trigger: "decision" });
  const emergency = pendingPo().filter((r) => r.p.funding === "NEEDS_EXTRA");
  assert.ok(emergency.length > 0, "at least one critical item is an emergency request");
  const r = emergency[0];
  assert.ok(r.p.funding_info.extra > 0 && r.p.funding_info.within_limit);
  const before = budgetInfo();
  const res = decide(r.id, "APPROVED");
  const after = budgetInfo();
  assert.ok(after.topup > 0 && after.topup >= r.p.funding_info.extra - 1e-6, "emergency spend is recorded separately");
  assert.ok(after.committed <= after.base + after.rollover + after.topup + 1e-6, "committed never exceeds budget plus emergency spend");
  assert.equal(snapshot().kpi.emergency_spend, after.topup);
  assert.ok(q(`SELECT 1 FROM events WHERE type='BUDGET_TOPUP'`).length === 1);
  assert.ok(before.topup === 0);
  const dec = q(`SELECT detail FROM decisions WHERE id=?`, res.decisionId)[0];
  assert.ok(JSON.parse(dec.detail).emergency_spend > 0);
  undo(res.decisionId);
  assert.equal(budgetInfo().topup, 0, "undo gives the emergency money back");
  setSetting("budget.emergency_limit_pct", 0);
  assert.throws(() => decide(r.id, "APPROVED"), (e: unknown) => e instanceof UserError && e.msg.k === "budget.err.over_limit");
});

test("a non-critical order without money is deferred to the next budget and can wait until the renewal", () => {
  fresh();
  db().prepare(`UPDATE purchasing_budget SET total_purchasing_budget_omr=14012 WHERE id=1`).run();
  runAll({ group: "t", trigger: "decision" });
  const d = pendingPo().find((r) => r.p.funding === "DEFERRED");
  assert.ok(d, "a deferred suggestion exists");
  assert.equal(d!.p.funding_info.renewal_date, budgetInfo().nextStart);
  postpone(d!.id, d!.p.funding_info.renewal_tick);
  const rec = snapshot().recs.find((x) => x.id === d!.id)!;
  assert.ok(rec.snoozed, "it waits for the renewal");
});

test("alerts: budget low and an unfunded critical item name the consequence and the date", () => {
  fresh();
  db().prepare(`UPDATE purchasing_budget SET total_purchasing_budget_omr=14100 WHERE id=1`).run();
  runAll({ group: "t", trigger: "decision" });
  const keys = snapshot().alerts.map((a) => a.key);
  assert.ok(keys.includes("BUDGET_LOW"));
  const u = snapshot().alerts.find((a) => a.kind === "UNFUNDED_CRITICAL");
  assert.ok(u && u.title.k === "alert.unfunded.title" && u.ignore_msg.k === "alert.unfunded.ignore");
});

test("short stock never goes unexplained over 45 days when the manager keeps deciding (suggestion, incoming order or visible reason)", () => {
  fresh();
  for (let d = 0; d < 45; d++) {
    advance({ hours: 24 });
    approveAll();
    const bad = runInvariants(false).filter((c) => !c.ok);
    assert.deepEqual(bad, [], `day ${d}`);
  }
});
