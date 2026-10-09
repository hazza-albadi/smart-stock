// Regression tests of the simulation review (docs/SIM_REVIEW.md). Each test names the finding it guards; each failed before its fix.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import en from "../locales/en.json";
import ar from "../locales/ar.json";
import { useDatabase, db, closeDb } from "../lib/db";
import { seedDatabase, defaultSettings } from "../lib/seed";
import { runAll } from "../lib/agents/coordinator";
import { tick } from "../lib/sim";
import { UserError } from "../lib/core";
import { loadSettings, setSetting, settingProblem } from "../lib/settings";
import { decide, postpone, editQty, manualMovement } from "../lib/decisions";
import { handle } from "../lib/api";
import { advance } from "../lib/sim";
import { snapshot } from "../lib/snapshot";
import { listWindow } from "../lib/space/actions";
import { createSpaceRequest } from "../lib/decisions";
import { getSim } from "../lib/core";

const file = path.join(os.tmpdir(), `smartstock-review-${process.pid}.db`);
const q = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).all(...a) as T[];
const fresh = (seed = 42) => { seedDatabase({ overrides: { "sim.auto_pause_critical": false, "sim.seed": seed } }); runAll({ group: "start", trigger: "start" }); };
before(() => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(file + e, { force: true }); useDatabase(file); });
test.after(() => { closeDb(); for (const e of ["", "-wal", "-shm"]) fs.rmSync(file + e, { force: true }); });

const refusedWith = (fn: () => unknown, key: string) => assert.throws(fn, (e: unknown) => e instanceof UserError && e.msg.k === key, `expected a refusal ${key}`);

test("C1: a setting of the wrong kind is refused in plain words and the clock keeps running", () => {
  fresh();
  refusedWith(() => setSetting("schedule.forecast_hours", 6), "settings.err.type");
  refusedWith(() => setSetting("schedule.forecast_hours", [6, 24]), "settings.err.hours");
  refusedWith(() => setSetting("sim.auto_pause_critical", "false"), "settings.err.type");
  refusedWith(() => setSetting("space.forecast_days", 0), "settings.err.min");
  refusedWith(() => setSetting("demand.noise", -0.1), "settings.err.min");
  refusedWith(() => setSetting("space.offer_base_prob", 1.5), "settings.err.max");
  refusedWith(() => setSetting("sim.start_date", "5 Oct"), "settings.err.date");
  refusedWith(() => setSetting("demand.hourly_profile", [1, 2, 3]), "settings.err.type");
  refusedWith(() => setSetting("no.such.key", 1), "settings.err.unknown");
  assert.deepEqual(loadSettings().j<number[]>("schedule.forecast_hours"), [6], "nothing was stored");
  // valid values are still accepted
  setSetting("schedule.forecast_hours", [6, 18]);
  setSetting("sim.auto_pause_critical", false);
  setSetting("po.emergency_premium", 1.2); // a premium may be above 100 %
  setSetting("sim.utc_offset_hours", -3);
  assert.doesNotThrow(() => { for (let i = 0; i < 3; i++) tick(); });
});

test("C1: every default value passes its own check (the defaults never trip the validation)", () => {
  for (const d of defaultSettings()) assert.equal(settingProblem(d.key, d.value, d.value, d.unit), null, d.key);
});

test("M4: every text uses the same placeholders and formats in English and Arabic (no '[object Object]')", () => {
  const P = /\{(\w+)(?::(\w+))?\}/g;
  const sig = (s: string) => [...s.matchAll(P)].map((m) => `${m[1]}:${m[2] ?? ""}`).sort().join(",");
  const E = en as Record<string, string>, A = ar as Record<string, string>;
  const bad = Object.keys(E).filter((k) => sig(E[k]) !== sig(A[k] ?? ""));
  assert.deepEqual(bad, []);
});

test("M2: refusals carry a message in the user's language; a real crash is a logged 500, not a 400", async () => {
  fresh();
  const r = q(`SELECT id FROM recommendations WHERE status='PENDING' AND kind='PO' ORDER BY id LIMIT 1`)[0];
  decide(r.id, "APPROVED");
  refusedWith(() => decide(r.id, "APPROVED"), "err.already_decided"); // double click / second tab
  refusedWith(() => decide(999999, "APPROVED"), "err.not_found");
  refusedWith(() => postpone(r.id), "err.already_decided");
  refusedWith(() => editQty(r.id, 5), "err.not_pending");
  refusedWith(() => manualMovement({ item: "nope", kind: "receipt", qty: 1, reason: "x" }), "err.unknown_item");
  const item = q(`SELECT item_id FROM items ORDER BY item_id LIMIT 1`)[0].item_id;
  refusedWith(() => manualMovement({ item, kind: "teleport" as "receipt", qty: 1, reason: "x" }), "err.bad_action");
  refusedWith(() => manualMovement({ item, kind: "issue", qty: 1e9, reason: "x" }), "err.not_enough_stock");
  const quiet = console.error; console.error = () => {};
  try {
    const crash = await handle(() => { throw new TypeError("boom"); });
    assert.equal(crash.status, 500);
    assert.equal((await crash.json()).msg.k, "err.server");
    const refused = await handle(() => decide(r.id, "APPROVED"));
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).msg.k, "err.already_decided");
  } finally { console.error = quiet; }
});

test("M1: a company that turns up after a listing was published gets a visible offer, valid from now (never born expired)", () => {
  fresh();
  setSetting("space.offer_validity_h", 24); setSetting("space.offer_base_prob", 1); setSetting("space.min_bid_ratio", 0);
  const w = snapshot().space.windows.filter((x) => x.state === "NEW").sort((a, b) => b.area - a.area)[0];
  listWindow({ zone_id: w.zone_id, area: w.area, start_date: w.start, end_date: w.suggest.end, price: 4, publish: true });
  advance({ hours: 130 }); // well past every planned arrival + validity
  createSpaceRequest({ company: "Late Arrival Co", type: loadSettings().s("space.rentable_request_type"), area: 120, months: 2, from: w.start });
  advance({ hours: 1 });
  const now = getSim().tick;
  const o = q(`SELECT status, arrived_tick, valid_until_tick FROM space_offers WHERE company='Late Arrival Co'`);
  assert.equal(o.length, 1, "the late company sent an offer");
  assert.equal(o[0].status, "PENDING", "the offer is waiting for the manager, not already expired");
  assert.ok(o[0].arrived_tick >= now - 1 && o[0].valid_until_tick === o[0].arrived_tick + 24, JSON.stringify(o[0]));
});

test("M3: postponing, editing a quantity and adding a company request re-run all five agents at once", () => {
  fresh();
  const runs = () => q(`SELECT COUNT(*) n FROM agent_runs`)[0].n as number;
  const [a, b] = q(`SELECT id FROM recommendations WHERE status='PENDING' AND kind='PO' ORDER BY id LIMIT 2`);
  let n = runs(); postpone(a.id); assert.equal(runs() - n, 5, "postpone");
  n = runs(); editQty(b.id, 10); assert.equal(runs() - n, 5, "edit quantity");
  n = runs(); createSpaceRequest({ company: "New Co", type: "general", area: 150, months: 2, from: "2026-11-01" }); assert.equal(runs() - n, 5, "company request");
});
