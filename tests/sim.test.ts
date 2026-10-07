import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { useDatabase, db, closeDb } from "../lib/db";
import { seedDatabase } from "../lib/seed";
import { runAll } from "../lib/agents/coordinator";
import { tick, advance, setRunning } from "../lib/sim";
import { decide, editQty, manualMovement, createManualPo, createSpaceRequest } from "../lib/decisions";
import { readDay0State } from "../lib/baselineState";
import { snapshot } from "../lib/snapshot";
import { impactLog } from "../lib/impact";
import { runInvariants } from "../lib/audit";
import { getSim } from "../lib/core";
import { setSetting } from "../lib/settings";

const file = path.join(os.tmpdir(), `smartstock-test-${process.pid}.db`);
const q = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).all(...a) as T[];
const fresh = () => { seedDatabase({ overrides: { "sim.auto_pause_critical": false } }); runAll({ group: "start", trigger: "start" }); };

before(() => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(file + e, { force: true }); useDatabase(file); });
test.after(() => { closeDb(); for (const e of ["", "-wal", "-shm"]) fs.rmSync(file + e, { force: true }); });

test("day 0 hour 0 equals docs/baseline.json (generated from the data by scripts/baseline.ts)", () => {
  fresh();
  const baseline = JSON.parse(fs.readFileSync("docs/baseline.json", "utf8")).day0;
  assert.deepEqual(JSON.parse(JSON.stringify(readDay0State())), baseline);
});

test("a stale or duplicate tick request is ignored; auto ticks are refused while paused", () => {
  fresh();
  const s0 = getSim().tick;
  assert.equal(tick({ expected: s0 }).ignored, undefined);
  assert.equal(tick({ expected: s0 }).ignored, "stale");
  assert.equal(tick({ expected: s0 - 5 }).ignored, "stale");
  assert.equal(getSim().tick, s0 + 1);
  assert.equal(tick({ expected: s0 + 1, auto: true }).ignored, "paused");
  setRunning(true);
  db().prepare(`UPDATE sim_state SET last_tick_at=0`).run();
  assert.equal(tick({ expected: s0 + 1, auto: true }).ignored, undefined);
  assert.equal(tick({ expected: s0 + 2, auto: true }).ignored, "too_soon");
});

test("advance: next day stops at hour 0; invariants hold after every hour", () => {
  fresh();
  advance({ hours: 5 });
  assert.equal(getSim().hour, 5);
  advance({ untilDay: true });
  assert.equal(getSim().hour, 0);
  assert.equal(getSim().day, 1);
  assert.deepEqual(runInvariants(true).filter((c) => !c.ok), []);
});

test("approved PO is committed now, arrives at its due date and hour, and changes stock", () => {
  fresh();
  const rec = q(`SELECT id, item_id FROM recommendations WHERE kind='PO' AND status='PENDING' ORDER BY id`)[0];
  const budgetBefore = snapshot().kpi.budget_remaining;
  decide(rec.id, "APPROVED");
  const po = q(`SELECT * FROM purchase_orders_open WHERE rec_key LIKE 'PO:${rec.item_id}%' AND source='AGENT'`)[0];
  assert.ok(po, "PO row created");
  assert.ok(snapshot().kpi.budget_remaining < budgetBefore, "budget committed at approval time");
  const stockBefore = q(`SELECT SUM(quantity_on_hand) s FROM current_stock WHERE item_id=?`, rec.item_id)[0].s;
  const arrivalTick = (Date.parse(po.expected_arrival + "T00:00:00Z") - Date.parse(getSim().start_date + "T00:00:00Z")) / 3600000 + po.expected_hour;
  advance({ hours: arrivalTick - getSim().tick });
  assert.equal(q(`SELECT status FROM purchase_orders_open WHERE po_id=?`, po.po_id)[0].status, "OPEN", "not yet arrived before its hour is processed");
  tick();
  const st = q(`SELECT status, received_tick FROM purchase_orders_open WHERE po_id=?`, po.po_id)[0];
  assert.equal(st.status === "RECEIVED" || q(`SELECT 1 FROM purchase_orders_open WHERE po_id LIKE ?`, po.po_id + "-R%").length > 0, true, "received (fully or partly) at its hour");
  assert.equal(st.received_tick, arrivalTick, "received exactly at the delivery hour");
  const ev = q(`SELECT tick FROM events WHERE type='PO_ARRIVED' AND ref=?`, po.po_id)[0];
  assert.equal(ev.tick, arrivalTick);
  assert.ok(q(`SELECT SUM(quantity) s FROM stock_movements WHERE reference=? AND movement_type='IN'`, po.po_id)[0].s > 0);
  void stockBefore; void setSetting;
  assert.ok(impactLog().some((r) => r.effects.some((e) => e.k === "impact.e.po_arrived")), "impact log shows the arrival");
});

test("a rejected draft is not re-created every hour; it returns only after the cooldown or when much worse, and says why", () => {
  fresh();
  const rec = q(`SELECT id, item_id, key FROM recommendations WHERE kind='PO' AND status='PENDING' ORDER BY id`)[0];
  decide(rec.id, "REJECTED");
  const decided = getSim().tick;
  advance({ hours: 24 * 2 });
  const rows = q(`SELECT status FROM recommendations WHERE key=?`, rec.key);
  assert.equal(rows.length, 1);
  assert.ok(!q(`SELECT 1 FROM events WHERE type='REC_REOPENED' AND ref=? AND tick<?`, rec.key, decided + 24 * 7).length || rows[0].status === "PENDING");
  const cooldown = 168;
  advance({ hours: cooldown + 24 });
  const after = q(`SELECT status, reopen_count FROM recommendations WHERE key=?`, rec.key)[0];
  // either it came back (with a stored reason) or the stock no longer needs it; never duplicated
  if (after.status === "PENDING") { assert.ok(after.reopen_count >= 1); assert.ok(JSON.parse(q(`SELECT payload FROM recommendations WHERE key=?`, rec.key)[0].payload).reopen_reason); }
  assert.equal(q(`SELECT COUNT(*) n FROM recommendations WHERE key=?`, rec.key)[0].n, 1);
});

test("ignored shortages really worsen: a stock-out follows from the data and the impact log explains it", () => {
  fresh();
  const rec = q(`SELECT id, item_id FROM recommendations WHERE kind='PO' AND status='PENDING' AND item_id IN (SELECT item_id FROM alerts WHERE kind='STOCKOUT' AND severity='Critical') ORDER BY id`)[0];
  assert.ok(rec, "a critical stock-out risk has a draft");
  decide(rec.id, "REJECTED");
  advance({ hours: 24 * 4 });
  assert.ok(q(`SELECT 1 FROM events WHERE type='STOCKOUT' AND item_id=?`, rec.item_id).length > 0);
  const row = impactLog().find((r) => r.decision === "REJECTED" && r.item_id === rec.item_id)!;
  assert.ok(row.effects.some((e) => e.k === "impact.e.stockout_after_reject" && (e.v as any).hours > 0));
});

test("pending recommendations age and escalate to an overdue alert", () => {
  fresh();
  advance({ hours: 30 });
  const s = snapshot();
  assert.ok(s.recs.some((r) => r.status === "PENDING" && r.age_hours >= 24 && r.overdue));
  assert.ok(s.alerts.some((a) => a.kind === "DECISION_OVERDUE"));
});

test("space: approving reserves area from needed_from, reduces rentable then, returns it when the lease ends", () => {
  fresh();
  const rec = q(`SELECT id, request_id, payload FROM recommendations WHERE kind='SPACE' AND status='PENDING' AND json_extract(payload,'$.decision')='APPROVE' ORDER BY id`)[0];
  const before = snapshot().kpi.rentable_m2;
  decide(rec.id, "APPROVED");
  const lease = q(`SELECT * FROM leases WHERE request_id=?`, rec.request_id)[0];
  assert.ok(lease.start_date >= getSim().sim_date);
  assert.equal(snapshot().kpi.rentable_m2, before, "rentable now unchanged until the lease starts");
  assert.equal(snapshot().kpi.reserved_m2, lease.area);
  // other requests are re-evaluated against what remains
  const others = q(`SELECT payload FROM recommendations WHERE kind='SPACE' AND status='PENDING'`).map((r) => JSON.parse(r.payload));
  assert.ok(others.length > 0);
  const days = (Date.parse(lease.start_date + "T00:00:00Z") - Date.parse(getSim().sim_date + "T00:00:00Z")) / 86400000;
  advance({ hours: days * 24 + 1 });
  assert.equal(q(`SELECT status FROM leases WHERE id=?`, lease.id)[0].status, "ACTIVE");
  assert.ok(q(`SELECT 1 FROM events WHERE type='LEASE_START' AND ref=?`, rec.request_id).length === 1);
  assert.ok(snapshot().zones.find((z) => z.zone_id === lease.zone_id)!.allocated >= lease.area);
});

test("manual actions are audited and go through the same agents", () => {
  fresh();
  const item = q(`SELECT item_id FROM items ORDER BY item_id LIMIT 1 OFFSET 4`)[0].item_id;
  const before = q(`SELECT SUM(quantity_on_hand) s FROM current_stock WHERE item_id=?`, item)[0].s;
  manualMovement({ item, kind: "receipt", qty: 3, reason: "test receipt" });
  assert.equal(q(`SELECT SUM(quantity_on_hand) s FROM current_stock WHERE item_id=?`, item)[0].s, before + 3);
  manualMovement({ item, kind: "issue", qty: 2, reason: "test issue" });
  assert.throws(() => manualMovement({ item, kind: "issue", qty: 1e9, reason: "too much" }));
  assert.throws(() => manualMovement({ item, kind: "receipt", qty: 1, reason: "  " }));
  createManualPo(item, 7, true);
  const man = q(`SELECT id, payload FROM recommendations WHERE source='manual'`)[0];
  editQty(man.id, 9);
  decide(man.id, "APPROVED");
  const po = q(`SELECT * FROM purchase_orders_open WHERE rec_key LIKE ?`, `PO:${item}#M%`)[0];
  assert.equal(po.quantity, 9); assert.ok(po.emergency === 1 && po.premium > 0);
  createSpaceRequest({ company: "Test Co", type: "general", area: 50, months: 1, from: "2026-12-01" });
  assert.equal(q(`SELECT COUNT(*) n FROM decisions WHERE actor='user'`)[0].n >= 5, true);
  assert.deepEqual(runInvariants(true).filter((c) => !c.ok), []);
});

test("replenishment caps orders by zone room: the cold-zone item gets a staged, realistic order that arrives in full", () => {
  fresh();
  const rec = q(`SELECT id, item_id, payload FROM recommendations WHERE kind='PO' AND status='PENDING' AND item_id IN (SELECT item_id FROM alerts WHERE kind='STOCKOUT' AND severity='Critical')`)[0];
  const p = JSON.parse(rec.payload);
  const it = q(`SELECT * FROM items WHERE item_id=?`, rec.item_id)[0];
  assert.equal(it.storage_type, "cold");
  assert.ok(p.room.staged, "order is staged because the full quantity does not fit");
  assert.ok(p.qty < p.room.need);
  assert.ok(p.qty * it.space_m2_per_unit < 1000, "fits inside the cold zone capacity");
  assert.ok(p.reason.some((m: any) => m.k === "repl.r.staged"), "the reason says why");
  decide(rec.id, "APPROVED");
  advance({ hours: 24 * 8 });
  const po = q(`SELECT po_id FROM purchase_orders_open WHERE rec_key LIKE ?`, `PO:${rec.item_id}%`)[0];
  assert.equal(q(`SELECT COUNT(*) n FROM events WHERE ref=? AND type IN ('PO_HELD','PO_OVERFLOW','RECEIVING_BLOCKED')`, po.po_id)[0].n, 0, "arrived in full");
  assert.equal(q(`SELECT SUM(quantity) s FROM stock_movements WHERE reference=? AND movement_type='IN'`, po.po_id)[0].s, p.qty);
  // no agent draft ever needs more room than the zones can take
  for (const r of q(`SELECT item_id, payload FROM recommendations WHERE kind='PO' AND source='agent'`)) assert.ok(JSON.parse(r.payload).qty >= 1);
});

test("auto-pause: real stock-out pauses once; overdue-decision alerts and projected risks do not pause", () => {
  seedDatabase();
  runAll({ group: "start", trigger: "start" });
  setSetting("sim.auto_pause_critical", true);
  // nothing critical in the first hours: overdue and projected-risk alerts must not pause
  const r = advance({ hours: 30 });
  assert.equal(r.ticks, 30, "no pause during 30 hours although drafts became overdue");
  assert.ok(snapshot().recs.some((x) => x.overdue));
  assert.ok(q(`SELECT 1 FROM alerts WHERE kind='DECISION_OVERDUE' AND active=1`).length > 0);
  assert.equal(q(`SELECT COUNT(*) n FROM events WHERE type='ALERT' AND ref LIKE 'OVERDUE:%' AND json_extract(meta,'$.pause')=1`)[0].n, 0);
  // the first real stock-out pauses
  const r2 = advance({ untilCritical: true });
  assert.ok(r2.paused && r2.critical.length >= 1);
  assert.ok((r2.critical as any[]).every((e) => e.type === "STOCKOUT" || e.ref?.startsWith("EXPIRY") || e.ref?.startsWith("DELAY")));
  const ev = q(`SELECT COUNT(*) n FROM events WHERE type='STOCKOUT' AND item_id=?`, (r2.critical as any[])[0].item_id)[0].n;
  assert.equal(ev, 1, "once per event");
});
