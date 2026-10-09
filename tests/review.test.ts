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
import { alertAgent, alertsVerify } from "../lib/agents/alerts";
import { tick } from "../lib/sim";
import { UserError } from "../lib/core";
import { loadSettings, setSetting, settingProblem } from "../lib/settings";
import { decide, postpone, editQty, manualMovement } from "../lib/decisions";
import { handle } from "../lib/api";
import { ensureSeeded } from "../lib/ensure";
import { advance } from "../lib/sim";
import { snapshot } from "../lib/snapshot";
import { listWindow, listingAction } from "../lib/space/actions";
import { addDays } from "../lib/time";
import { createSpaceRequest } from "../lib/decisions";
import { getSim } from "../lib/core";
import { render } from "../lib/render";
import { diffSnapshots } from "../lib/changes";
import { guideDone } from "../lib/guide";
import { demandCurve, demandOver, type SeasonCfg } from "../lib/calc";
import { settingsTableBlock, replaceSettingsTable } from "../lib/settings-table";

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

test("m1: the zone-over-capacity alert has its if-ignored message, so the Alerts agent passes its own check", () => {
  fresh();
  const z = q(`SELECT zone_id, capacity_m2 c FROM warehouse_zones ORDER BY zone_id LIMIT 1`)[0];
  const it = q(`SELECT item_id, space_m2_per_unit sp FROM items WHERE zone_id=? LIMIT 1`, z.zone_id)[0];
  db().prepare(`INSERT INTO current_stock VALUES('LOT-OVER',?,?,?,'2026-10-05',NULL)`).run(it.item_id, z.zone_id, Math.ceil((z.c * 2) / it.sp)); // data that overfills the zone
  alertAgent("t", "test");
  assert.equal(q(`SELECT COUNT(*) n FROM alerts WHERE kind='SPACE_OVER' AND active=1`)[0].n, 1);
  assert.deepEqual(alertsVerify().filter((c) => !c.ok), []);
});

test("m2: the settings table of README.md is the one generated from config/defaults.json", () => {
  const doc = fs.readFileSync("README.md", "utf8").split(String.fromCharCode(13)).join(""); // CRLF checkouts
  const next = replaceSettingsTable(doc, settingsTableBlock(defaultSettings()));
  assert.ok(next !== null, "markers present");
  assert.equal(next, doc, "run npm run docs:agents");
});

test("M5: the conflict card of a partly leased listing offers a shrink that keeps the leased part, and the server accepts it", () => {
  fresh();
  const w = snapshot().space.windows.filter((x) => x.state === "NEW").sort((a, b) => b.area - a.area)[0];
  const { listingId } = listWindow({ zone_id: w.zone_id, area: w.area, start_date: w.start, end_date: w.suggest.end, price: 4, publish: true });
  const leased = Math.floor((w.area * 0.6) / 10) * 10;
  db().prepare(`INSERT INTO space_leases(offer_id,listing_id,request_id,company,zone_id,area,start_date,end_date,price,status,signed_tick,income,income_days) VALUES(0,?,'T','Test Co',?,?,?,?,4,'RESERVED',0,0,0)`)
    .run(listingId, w.zone_id, leased, w.start, w.suggest.end);
  // an approved order that needs the rest of the listing (and more) for the whole period
  const it = q(`SELECT * FROM items WHERE zone_id=? ORDER BY space_m2_per_unit DESC LIMIT 1`, w.zone_id)[0];
  db().prepare(`INSERT INTO purchase_orders_open(po_id,item_id,supplier_id,quantity,order_date,expected_arrival,status,source,received_date,expected_hour,ordered_tick,received_tick,emergency,premium,rec_key)
    VALUES('TEST-SQUEEZE',?,?,?,?,?,'OPEN','AGENT',NULL,12,0,NULL,0,0,NULL)`).run(it.item_id, it.supplier_id, Math.ceil(5000 / it.space_m2_per_unit), getSim().sim_date, addDays(w.start, -3));
  runAll({ group: "t", trigger: "decision" });
  const c = snapshot().space.conflicts.find((x) => x.listing_id === listingId);
  assert.ok(c, "the squeezed listing is flagged");
  assert.equal(c.shrink_to, leased + c.ok_area, "shrink target = leased part + what still fits");
  assert.ok(c.shrink_to >= leased);
  assert.ok(c.can_shrink, JSON.stringify(c));
  {
    listingAction(listingId, "shrink", c.shrink_to);
    assert.equal(q(`SELECT area FROM space_listings WHERE id=?`, listingId)[0].area, c.shrink_to);
  }
});

test("P1: the shared demand curve gives exactly the numbers of demandOver (bit for bit), so results do not change", () => {
  const season = defaultSettings().find((d) => d.key === "demand.season")!.value as SeasonCfg;
  for (const itemId of [season.items[0], "NOT-SEASONAL"]) {
    for (const now of [{ date: "2026-10-05", hour: 0 }, { date: "2026-12-30", hour: 17 }, { date: "2027-03-01", hour: 23 }]) {
      const m = { itemId, baseWeekly: 123.456, season };
      const curve = demandCurve(m, now);
      for (const h of [0, 0.5, 1, 6, 7, 23.5, 24, 25, 47, 48, 100.25]) assert.equal(curve(h), demandOver(m, now, h), `${itemId} ${now.date} ${h}`);
      for (let h = 0; h <= 400 * 24; h += 13) assert.equal(curve(h), demandOver(m, now, h), `${itemId} ${now.date} ${h}`);
    }
  }
});

test("m5: months are written with the right Arabic agreement", () => {
  const ar = (n: number) => render("ar", { k: "sp.btn.list", v: { area: 100, months: n, price: 4 } });
  assert.match(ar(6), /٦ أشهر/); assert.match(ar(12), /١٢ شهراً/); assert.match(ar(2), /شهرين/);
  assert.doesNotMatch(ar(6), /٦ شهر /);
  assert.match(render("en", { k: "sp.btn.list", v: { area: 100, months: 1, price: 4 } }), /for 1 month /);
});

test("m4: 'no room to order' is not critical while an order for the item is already on its way", () => {
  fresh();
  // the demo case: approve the frozen-shrimp order when it has run out; the rest cannot be ordered for lack of room
  for (let i = 0; i < 60 && !q(`SELECT 1 FROM events WHERE type='STOCKOUT'`).length; i++) tick();
  const out = q(`SELECT item_id FROM events WHERE type='STOCKOUT' ORDER BY id LIMIT 1`)[0]?.item_id;
  assert.ok(out, "an item ran out");
  const r = q(`SELECT id FROM recommendations WHERE kind='PO' AND status='PENDING' AND item_id=?`, out)[0];
  if (r) decide(r.id, "APPROVED");
  for (const a of q(`SELECT a.severity, a.item_id FROM alerts a WHERE a.kind='NO_ROOM' AND a.active=1`)) {
    const incoming = q(`SELECT 1 FROM purchase_orders_open WHERE item_id=? AND status IN ('OPEN','DELAYED_BY_SUPPLIER')`, a.item_id).length > 0;
    if (incoming) assert.notEqual(a.severity, "Critical", a.item_id);
  }
});

test("m6: a corrupt database file is moved aside and a fresh one is seeded, instead of every request failing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-corrupt-"));
  const bad = path.join(dir, "smartstock.db");
  fs.writeFileSync(bad, "this is not a database ".repeat(100));
  const quiet = console.warn; console.warn = () => {};
  try {
    useDatabase(bad);
    ensureSeeded();
    assert.equal(snapshot().sim.tick, 0);
    assert.ok(fs.readdirSync(dir).some((f) => f.startsWith("smartstock.db.corrupt-")), "the broken file is kept for inspection");
  } finally {
    console.warn = quiet; closeDb(); useDatabase(file);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("X1: 'next important event' stops at the first hour that brings something to look at, says what it was, and is deterministic", () => {
  const run = () => {
    fresh();
    const stops: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = advance({ untilEvent: true });
      assert.ok(r.stop, "always says why it stopped");
      assert.ok(r.ticks >= 1 && r.ticks <= loadSettings().n("sim.max_advance_hours"));
      if (r.stop!.why === "event") assert.ok((r.stop!.event as { msg?: { k?: string } }).msg?.k, "the event carries a message to show");
      stops.push(`${r.tick}:${r.stop!.why}:${(r.stop!.event as { type?: string } | undefined)?.type ?? r.stop!.waiting ?? ""}`);
    }
    return stops;
  };
  const a = run();
  assert.ok(a.some((x) => !x.endsWith(":none")), JSON.stringify(a));
  assert.deepEqual(run(), a, "same seed, same stops");
});

test("X2: after a decision the change summary names the five agents that ran again and the numbers that moved", () => {
  fresh();
  const before = snapshot();
  const r = q(`SELECT id FROM recommendations WHERE status='PENDING' AND kind='PO' ORDER BY id LIMIT 1`)[0];
  decide(r.id, "APPROVED");
  const c = diffSnapshots(before, snapshot());
  assert.deepEqual(c.agents, before.agent_order, "all five, in registry order");
  const keys = c.lines.map((l) => l.k);
  assert.ok(keys.includes("chg.budget") && keys.includes("chg.orders"), keys.join(","));
  for (const l of c.lines) assert.notEqual(render("ar", l).includes("{"), true, l.k); // every line renders
  assert.deepEqual(diffSnapshots(snapshot(), snapshot()).lines.map((l) => l.k), ["chg.none"]);
});

test("m7: every unit has its own word in each language (two units were both 'gallon' in Arabic)", () => {
  for (const L of [en, ar] as Record<string, string>[]) {
    const words = Object.keys(L).filter((k) => k.startsWith("unit.")).map((k) => L[k].replace(/غ/g, "ج")); // غالون and جالون are the same word
    assert.equal(new Set(words).size, words.length, words.join(", "));
  }
});

test("X3: the guided demo ticks each step only when it really happened", () => {
  fresh();
  assert.deepEqual(guideDone(snapshot()), [false, false, false, false, false, false]);
  tick();
  assert.deepEqual(guideDone(snapshot()).slice(0, 3), [true, true, false], "clock ran, a risk is shown");
  const r = q(`SELECT id FROM recommendations WHERE status='PENDING' AND kind='PO' ORDER BY id LIMIT 1`)[0];
  decide(r.id, "APPROVED");
  assert.equal(guideDone(snapshot())[2], true, "order approved");
  const w = snapshot().space.windows.filter((x) => x.state === "NEW")[0];
  const { listingId } = listWindow({ zone_id: w.zone_id, area: w.area, start_date: w.start, end_date: w.suggest.end, price: 4, publish: true });
  assert.deepEqual(guideDone(snapshot()).slice(3), [true, false, false], "listed");
  // a rental that starts today (what accepting an offer leads to): rent is counted at the next midnight
  db().prepare(`INSERT INTO space_leases(offer_id,listing_id,request_id,company,zone_id,area,start_date,end_date,price,status,signed_tick,income,income_days) VALUES(0,?,'T','Test Co',?,100,?,?,4,'ACTIVE',0,0,0)`)
    .run(listingId, w.zone_id, getSim().sim_date, w.suggest.end);
  assert.deepEqual(guideDone(snapshot()).slice(4), [true, false]);
  advance({ hours: 25 - getSim().hour }); // midnight itself is processed one tick later
  assert.equal(guideDone(snapshot())[5], true, "rent earned");
});

test("m8: no hard-coded '→' between values in components (it points backwards in Arabic; use <To />)", () => {
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((f) => (f.isDirectory() ? walk(path.join(d, f.name)) : f.name.endsWith(".tsx") ? [path.join(d, f.name)] : []));
  const bad = walk("components").filter((f) => /<\/span>\s*→\s*<span|join\(" → "\)/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(bad, []);
});

test("X1b: 'next event' does not stop again for the same alert within a day (an alert that flickers near its threshold)", () => {
  fresh();
  const seen = new Map<string, number>();
  for (let i = 0; i < 12; i++) {
    const r = advance({ untilEvent: true });
    const ev = r.stop?.event as { type?: string; ref?: string; meta?: { pause?: boolean } } | undefined;
    if (ev?.type === "ALERT" && !ev.meta?.pause && ev.ref) {
      const last = seen.get(ev.ref);
      assert.ok(last === undefined || r.tick - last > 24, `stopped twice within a day for ${ev.ref}`);
      seen.set(ev.ref, r.tick);
    }
  }
});
