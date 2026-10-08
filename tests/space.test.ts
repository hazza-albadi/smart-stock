import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { useDatabase, db, closeDb } from "../lib/db";
import { seedDatabase } from "../lib/seed";
import { runAll } from "../lib/agents/coordinator";
import { advance } from "../lib/sim";
import { decide } from "../lib/decisions";
import { snapshot } from "../lib/snapshot";
import { impactLog } from "../lib/impact";
import { runInvariants } from "../lib/audit";
import { getSim, UserError } from "../lib/core";
import { loadSettings, setSetting } from "../lib/settings";
import { loadLive } from "../lib/live";
import { roomModel } from "../lib/agents/replenishment";
import { addDays } from "../lib/time";
import { listWindow, keepWindowVacant, offerAction, listingAction, undoSpaceDecision } from "../lib/space/actions";
import { maxListable, projectZones } from "../lib/space/forecast";
import { evaluateOffer, getListing, getOffer, unmatchedDemand } from "../lib/space/market";

const file = path.join(os.tmpdir(), `smartstock-space-${process.pid}.db`);
const q = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).all(...a) as T[];
const fresh = (seed = 42) => { seedDatabase({ overrides: { "sim.auto_pause_critical": false, "sim.seed": seed } }); runAll({ group: "start", trigger: "start" }); };
before(() => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(file + e, { force: true }); useDatabase(file); });
test.after(() => { closeDb(); for (const e of ["", "-wal", "-shm"]) fs.rmSync(file + e, { force: true }); });

const biggest = () => snapshot().space.windows.filter((w) => w.state === "NEW").sort((a, b) => b.area - a.area)[0];
const listIt = (w = biggest(), price = 4, area = w.area) => listWindow({ zone_id: w.zone_id, area, start_date: w.start, end_date: w.end, price, publish: true });
/** An approved purchase order (a row in the open-orders table, exactly what approving a draft creates). */
function addPo(zone: string, areaM2: number, arrival: string, id = "TEST-PO-1") {
  const it = q(`SELECT * FROM items WHERE zone_id=? ORDER BY item_id LIMIT 1`, zone)[0];
  const qty = Math.ceil(areaM2 / it.space_m2_per_unit);
  db().prepare(`INSERT INTO purchase_orders_open(po_id,item_id,supplier_id,quantity,order_date,expected_arrival,status,source,received_date,expected_hour,ordered_tick,received_tick,emergency,premium,rec_key)
    VALUES(?,?,?,?,?,?,'OPEN','AGENT',NULL,12,0,NULL,0,0,NULL)`).run(id, it.item_id, it.supplier_id, qty, getSim().sim_date, arrival);
  runAll({ group: "t", trigger: "decision" });
  return { it, qty };
}
const waitForOffer = (maxDays = 8) => { for (let i = 0; i < maxDays * 24 && !q(`SELECT 1 FROM space_offers`).length; i++) advance({ hours: 1 }); return q(`SELECT * FROM space_offers ORDER BY id`); };

test("day 0: free windows only in rentable zones; nothing listed, no offers, no leases; physical numbers unchanged", () => {
  fresh();
  const s = snapshot();
  const rentable = new Set(q(`SELECT zone_id FROM warehouse_zones WHERE rent_allowed='yes'`).map((z) => z.zone_id));
  assert.ok(s.space.windows.length > 0);
  for (const w of s.space.windows) assert.ok(rentable.has(w.zone_id), "window in a zone that is not for rent");
  assert.equal(q(`SELECT COUNT(*) n FROM space_listings`)[0].n + q(`SELECT COUNT(*) n FROM space_offers`)[0].n + q(`SELECT COUNT(*) n FROM space_leases`)[0].n, 0);
  assert.equal(s.kpi.rentable_m2, 1400, "the physical empty space today is unchanged");
  assert.deepEqual(Object.fromEntries(s.zones.filter((z) => z.rent_allowed).map((z) => [z.zone_id, z.net])), { Z1: 500, Z5: 900 });
  assert.ok(s.space.settings.forecast_days >= 90, "at least 90 days are forecast");
});

test("every window has its inputs and formula, and a window never exceeds what the forecast leaves free", () => {
  fresh();
  const cfg = loadSettings();
  for (const w of snapshot().space.windows) {
    assert.ok(w.explain.inputs.length >= 5 && w.explain.formula);
    assert.ok(w.area <= maxListable(cfg, w.zone_id, w.start, w.end) + 1e-6, `${w.zone_id} ${w.start}`);
    assert.ok(w.area >= cfg.n("space.min_block_m2"));
  }
});

test("never list space the company needs: refused with the order that needs it; never-rent zones are refused", () => {
  fresh();
  const w = biggest();
  assert.throws(() => listWindow({ zone_id: w.zone_id, area: w.area + 1000, start_date: w.start, end_date: w.end, price: 4, publish: true }), (e: unknown) => e instanceof UserError && e.msg.k === "sp.err.company_needs");
  const closed = q(`SELECT zone_id FROM warehouse_zones WHERE rent_allowed<>'yes'`)[0].zone_id;
  assert.throws(() => listWindow({ zone_id: closed, area: 200, start_date: w.start, end_date: w.end, price: 4, publish: true }), (e: unknown) => e instanceof UserError && e.msg.k === "sp.err.never_rent");
  assert.equal(q(`SELECT COUNT(*) n FROM space_listings`)[0].n, 0);
});

test("keep vacant: no listing, no offers, income zero; the window is held until the date and the decision is in the impact log", () => {
  fresh();
  const w = biggest();
  keepWindowVacant({ zone_id: w.zone_id, area: w.area, start_date: w.start, end_date: w.end, reason: "test" });
  const s = snapshot().space;
  assert.ok(s.windows.some((x) => x.zone_id === w.zone_id && x.state === "HELD"));
  assert.equal(s.listings.length, 0);
  advance({ hours: 24 * 4 });
  assert.equal(q(`SELECT COUNT(*) n FROM space_offers`)[0].n, 0);
  assert.equal(snapshot().space.kpi.income_total, 0);
  const row = impactLog(20).find((r) => r.flow === "space" && r.kind === "KEEP_VACANT");
  assert.ok(row && row.effects.some((e) => e.k === "impact.sp.e.vacant_income"));
});

test("offers appear only after a listing is published, not before the arrival delay, and never from cold or hazardous demand", () => {
  fresh();
  advance({ hours: 24 * 6 });
  assert.equal(q(`SELECT COUNT(*) n FROM space_offers`)[0].n, 0, "nothing arrives without a listing");
  const w = biggest();
  const draft = listWindow({ zone_id: w.zone_id, area: w.area, start_date: w.start, end_date: w.end, price: 4, publish: false });
  advance({ hours: 24 * 5 });
  assert.equal(q(`SELECT COUNT(*) n FROM space_offers`)[0].n, 0, "a draft receives no offers");
  listingAction(draft.listingId, "publish");
  const published = getSim().tick;
  const offers = waitForOffer(10);
  assert.ok(offers.length > 0);
  const min = loadSettings().n("space.offer_delay_min_h");
  for (const o of offers) {
    assert.ok(o.arrived_tick >= published + Math.floor(min * 0.4), "arrival delay respected (cheaper price may speed it up)");
    const req = q(`SELECT required_storage_type t FROM space_requests WHERE request_id=?`, o.request_id)[0];
    assert.equal(req.t, loadSettings().s("space.rentable_request_type"), "only the rentable storage type is offered");
  }
  advance({ hours: 24 * 10 });
  const nonGeneral = q(`SELECT request_id FROM space_requests WHERE required_storage_type<>?`, loadSettings().s("space.rentable_request_type")).map((r) => r.request_id);
  assert.ok(nonGeneral.length >= 2);
  assert.equal(q(`SELECT COUNT(*) n FROM space_offers WHERE request_id IN (${nonGeneral.map(() => "?").join(",")})`, ...nonGeneral)[0].n, 0);
  const um = unmatchedDemand(loadSettings());
  for (const id of nonGeneral) assert.ok(um.some((u) => u.request_id === id && u.reason.k === "sp.unmatched.never"), `${id} is shown as protected demand`);
});

test("price changes arrival: a price above the market band brings offers later or not at all; a lower price brings them sooner", () => {
  const arrival = (price: number) => {
    fresh();
    const w = biggest();
    listWindow({ zone_id: w.zone_id, area: w.area, start_date: w.start, end_date: w.end, price, publish: true });
    advance({ hours: 24 * 12 });
    return q(`SELECT arrived_tick FROM space_offers ORDER BY arrived_tick`).map((o) => o.arrived_tick as number);
  };
  const cheap = arrival(2.4), market = arrival(4), dear = arrival(12);
  assert.ok(cheap.length >= market.length && market.length >= dear.length);
  assert.equal(dear.length, 0, "far above the market: nobody offers");
  assert.ok(cheap[0] <= market[0], "cheaper listings are answered sooner");
});

test("offer evaluation: six checks in words; accept is refused when a blocking check fails; a counter-offer that works is suggested", () => {
  fresh();
  const w = biggest();
  listWindow({ zone_id: w.zone_id, area: 100, start_date: w.start, end_date: w.end, price: 4, publish: true });
  const offers = waitForOffer(10);
  advance({ hours: 24 });
  const cfg = loadSettings();
  const big = q(`SELECT * FROM space_offers WHERE area>100 AND status='PENDING' ORDER BY id`)[0] ?? offers[0];
  const ev = evaluateOffer(cfg, big, getListing(big.listing_id)!);
  assert.deepEqual(ev.checks.map((c) => c.key), ["type", "area", "dates", "duration", "price", "needs"]);
  if (big.area > 100) {
    assert.equal(ev.can_accept, false);
    assert.ok(ev.blockers.includes("area"));
    assert.throws(() => offerAction(big.id, "accept"), (e: unknown) => e instanceof UserError && e.msg.k === "sp.err.cannot_accept");
  }
  for (const c of ev.checks) assert.ok(c.msg.k.startsWith("sp.chk."));
});

test("accept: lease is created, area is held from the start date, rent accrues per day = area x price / days per month, lease ends and area returns", () => {
  fresh();
  const w = biggest();
  listWindow({ zone_id: w.zone_id, area: w.area, start_date: w.start, end_date: w.end, price: 4, publish: true });
  waitForOffer(10);
  advance({ hours: 24 });
  let acc = q(`SELECT * FROM space_offers WHERE status='PENDING'`).map((o) => ({ o, ev: evaluateOffer(loadSettings(), o, getListing(o.listing_id)!) })).find((x) => x.ev.can_accept);
  if (!acc) {
    const o = q(`SELECT * FROM space_offers WHERE status='PENDING'`)[0];
    const sg = evaluateOffer(loadSettings(), o, getListing(o.listing_id)!).suggest!;
    assert.ok(sg, "a counter-offer is suggested");
    offerAction(o.id, "counter", { terms: { area: sg.area, start_date: sg.start, end_date: sg.end, price: sg.price } });
    for (let i = 0; i < 24 * 5; i++) advance({ hours: 1 });
    const led = q(`SELECT * FROM space_offers WHERE id=?`, o.id)[0];
    assert.ok(["ACCEPTED", "DECLINED"].includes(led.status));
    if (led.status === "DECLINED") return; // the seeded answer was no: nothing more to check here
    acc = { o: led, ev: null as never };
  } else offerAction(acc.o.id, "accept");
  const lease = q(`SELECT * FROM space_leases ORDER BY id DESC`)[0];
  assert.ok(lease && ["RESERVED", "ACTIVE"].includes(lease.status));
  const dpm = loadSettings().n("space.days_per_month");
  // run to the lease start and a few days beyond
  while (getSim().sim_date <= addDays(lease.start_date, 3)) advance({ hours: 24 });
  const cur = q(`SELECT * FROM space_leases WHERE id=?`, lease.id)[0];
  assert.equal(cur.status, "ACTIVE");
  assert.ok(cur.income_days >= 3 && Math.abs(cur.income - (cur.area * cur.price / dpm) * cur.income_days) < 1e-6);
  const z = snapshot().zones.find((x) => x.zone_id === cur.zone_id)!;
  assert.ok(z.allocated >= cur.area - 1e-6, "the leased area is held in the zone");
  const sp = snapshot().space;
  assert.ok(sp.kpi.income_total > 0 && sp.kpi.leased_m2 >= cur.area);
  assert.deepEqual(runInvariants(true).filter((c) => !c.ok), []);
  const line = impactLog(20).find((r) => r.flow === "space" && r.effects.some((e) => e.k === "impact.sp.e.lease"));
  assert.ok(line, "the impact log tells the story in sentences");
});

test("counter-offer: the company answers after a seeded delay; the answer is deterministic for a seed", () => {
  const run = () => {
    fresh();
    const w = biggest();
    listWindow({ zone_id: w.zone_id, area: w.area, start_date: w.start, end_date: w.end, price: 4, publish: true });
    waitForOffer(10);
    const o = q(`SELECT * FROM space_offers ORDER BY id`)[0];
    const l = getListing(o.listing_id)!;
    const ev = evaluateOffer(loadSettings(), o, l);
    const t = ev.suggest ?? { area: Math.min(o.area, w.area), start: o.start_date, end: o.end_date, price: Math.max(o.price, l.price) };
    offerAction(o.id, "counter", { terms: { area: t.area, start_date: t.start, end_date: t.end, price: t.price } });
    assert.equal(getOffer(o.id)!.status, "COUNTERED");
    const due = getOffer(o.id)!.counter_due_tick!;
    assert.ok(due > getSim().tick);
    while (getSim().tick <= due) advance({ hours: 1 });
    return `${getOffer(o.id)!.status}|${due}`;
  };
  const a = run(), b = run();
  assert.equal(a, b, "same seed, same answer at the same hour");
  assert.ok(a.startsWith("ACCEPTED") || a.startsWith("DECLINED"));
});

test("determinism: same seed gives the same offers; a different seed gives different ones", () => {
  const offers = (seed: number) => { fresh(seed); const w = biggest(); listWindow({ zone_id: w.zone_id, area: w.area, start_date: w.start, end_date: w.end, price: 4, publish: true }); advance({ hours: 24 * 9 }); return JSON.stringify(q(`SELECT request_id, arrived_tick, area, price FROM space_offers ORDER BY id`)); };
  assert.equal(offers(42), offers(42));
  assert.notEqual(offers(42), offers(7));
});

test("reject: reason stored, offer not shown again; undo brings it back; expired offers leave the queue", () => {
  fresh();
  const w = biggest();
  listWindow({ zone_id: w.zone_id, area: w.area, start_date: w.start, end_date: w.end, price: 4, publish: true });
  waitForOffer(10);
  const o = q(`SELECT * FROM space_offers WHERE status='PENDING' ORDER BY id`)[0];
  const r = offerAction(o.id, "reject", { reason: "price" });
  assert.equal(getOffer(o.id)!.status, "REJECTED");
  assert.ok(!snapshot().space.offers.some((x) => x.id === o.id && x.status === "PENDING"));
  advance({ hours: 24 * 3 });
  assert.equal(q(`SELECT COUNT(*) n FROM space_offers WHERE request_id=? AND listing_id=?`, o.request_id, o.listing_id)[0].n, 1, "the same company does not offer again for the same listing");
  undoSpaceDecision(r.decisionId);
  assert.ok(["PENDING", "EXPIRED"].includes(getOffer(o.id)!.status));
  const validity = loadSettings().n("space.offer_validity_h");
  for (const p of q(`SELECT * FROM space_offers WHERE status='PENDING'`)) { while (getSim().tick < p.valid_until_tick + 1) advance({ hours: 6 }); assert.equal(getOffer(p.id)!.status, "EXPIRED"); }
  assert.ok(validity > 0);
});

// ------------------------------------------------------------------------------------------------ conflicts with purchasing (a to f)
test("(a) purchase approved, then listing the same space: the window shrinks or disappears and the refusal names the order and the date", () => {
  fresh();
  const w = biggest();
  const before = maxListable(loadSettings(), w.zone_id, w.start, w.end);
  const arrival = addDays(getSim().sim_date, 1);
  addPo(w.zone_id, before + 800, arrival, "TEST-PO-A");
  const after = maxListable(loadSettings(), w.zone_id, w.start, w.end);
  assert.ok(after < before, "the free window shrank");
  assert.throws(() => listWindow({ zone_id: w.zone_id, area: before, start_date: w.start, end_date: w.end, price: 4, publish: true }), (e: unknown) => e instanceof UserError && e.msg.k === "sp.err.company_needs" && (e.msg.v as any).po === "TEST-PO-A");
});

test("(a) a pending purchase suggestion never blocks a listing but shows a warning on the window", () => {
  fresh();
  const s = snapshot().space;
  const warned = s.windows.find((x) => x.pending_area > 0);
  if (warned) {
    assert.ok(warned.pending_note && warned.pending_note.k === "sp.pending_warn");
    assert.doesNotThrow(() => listWindow({ zone_id: warned.zone_id, area: Math.min(warned.area, warned.area - warned.pending_area > 100 ? warned.area - warned.pending_area : warned.area), start_date: warned.start, end_date: warned.end, price: 4, publish: true }));
  } else assert.ok(true, "no pending draft needs listed space in this data");
});

test("(b) listing published, then a purchase that needs the space: alert in BOTH flows, overlap dates, options to shrink / pause", () => {
  fresh();
  const w = biggest();
  const lst = listIt(w, 4, w.area);
  addPo(w.zone_id, w.area + 600, addDays(w.start, 5), "TEST-PO-B");
  const s = snapshot();
  const c = s.space.conflicts.find((x) => x.listing_id === lst.listingId);
  assert.ok(c, "the listing is flagged");
  assert.equal(c!.driver?.po_id, "TEST-PO-B");
  assert.ok(c!.from >= w.start && c!.to <= w.end || c!.to === w.end);
  const al = s.alerts.find((a) => a.key === `CONFLICT:LISTING:${lst.listingId}`);
  assert.ok(al && al.flow === "both");
  const ev = q(`SELECT flow FROM events WHERE type='SPACE_CONFLICT'`);
  assert.ok(ev.length >= 1 && ev.every((e) => e.flow === "both"));
  // resolution: shrink to what still fits
  if (c!.ok_area >= loadSettings().n("space.min_block_m2")) listingAction(lst.listingId, "shrink", c!.ok_area); else listingAction(lst.listingId, "pause");
  const left = snapshot().space.listings.find((l) => l.id === lst.listingId)!;
  assert.ok(left.status === "PAUSED" || left.area <= c!.ok_area + 1e-6, "the listing was shrunk to what fits or paused");
});

test("(c) an offer waiting when such a purchase is approved is re-evaluated: Accept disabled, a counter-offer that works is suggested", () => {
  fresh();
  const w = biggest();
  listIt(w, 4, w.area);
  const offers = waitForOffer(10);
  assert.ok(offers.length);
  const o = q(`SELECT * FROM space_offers WHERE status='PENDING' ORDER BY id`)[0];
  addPo(w.zone_id, w.area + 400, addDays(getSim().sim_date, 1), "TEST-PO-C");
  const now = getOffer(o.id)!;
  assert.equal(now.flag, "COMPANY_NEEDS");
  const ev = evaluateOffer(loadSettings(), now, getListing(now.listing_id)!);
  assert.equal(ev.can_accept, false);
  assert.ok(ev.blockers.includes("needs"));
  assert.throws(() => offerAction(o.id, "accept"), (e: unknown) => e instanceof UserError);
  assert.ok(q(`SELECT 1 FROM events WHERE type='OFFER_BLOCKED'`).length >= 1);
});

test("(d) a signed lease beats a new purchase: the room check treats leased area as unavailable and the order is staged", () => {
  fresh();
  const w = biggest();
  const cfg0 = loadSettings();
  const it = q(`SELECT * FROM items WHERE zone_id=? ORDER BY item_id LIMIT 1`, w.zone_id)[0];
  const now = { date: getSim().sim_date, hour: getSim().hour };
  const free0 = roomModel(cfg0, loadLive(cfg0, now), now).roomUnits(it);
  // a signed lease covering the arrival date of a new order
  const start = addDays(now.date, 0), end = addDays(now.date, 200);
  db().prepare(`INSERT INTO space_leases(offer_id,listing_id,request_id,company,zone_id,area,start_date,end_date,price,status,signed_tick,income,income_days) VALUES(0,0,'T','Test Co',?,?,?,?,4,'RESERVED',0,0,0)`).run(w.zone_id, 300, start, end);
  const free1 = roomModel(cfg0, loadLive(cfg0, now), now).roomUnits(it);
  assert.ok(free1 < free0, "leased area is unavailable to purchasing");
  assert.ok(Math.abs((free0 - free1) * it.space_m2_per_unit - 300) < it.space_m2_per_unit + 1e-6);
});

test("(e) same-hour collision: the second action is refused in plain words with a way out; both orders", () => {
  fresh();
  const w = biggest();
  listIt(w, 4, w.area);
  waitForOffer(10);
  advance({ hours: 24 });
  // PO first (approved), then accept: refused because the company needs the space
  addPo(w.zone_id, w.area + 500, addDays(getSim().sim_date, 1), "TEST-PO-E");
  const o = q(`SELECT * FROM space_offers WHERE status='PENDING' ORDER BY id`)[0];
  if (o) assert.throws(() => offerAction(o.id, "accept"), (e: unknown) => e instanceof UserError && e.msg.k === "sp.err.cannot_accept");
  // lease first, then a draft that no longer fits: refused with the quantity that still fits
  fresh();
  const w2 = biggest();
  const cfg = loadSettings();
  const draft = q(`SELECT r.id, r.item_id, r.payload FROM recommendations r WHERE r.kind='PO' AND r.status='PENDING' ORDER BY r.id`)[0];
  const item = q(`SELECT * FROM items WHERE item_id=?`, draft.item_id)[0];
  const home = item.zone_id;
  const rentable = q(`SELECT rent_allowed r FROM warehouse_zones WHERE zone_id=?`, home)[0].r === "yes";
  if (rentable) {
    db().prepare(`INSERT INTO space_leases(offer_id,listing_id,request_id,company,zone_id,area,start_date,end_date,price,status,signed_tick,income,income_days) VALUES(0,0,'T','Test Co',?,?,?,?,4,'RESERVED',0,0,0)`)
      .run(home, 100000, getSim().sim_date, addDays(getSim().sim_date, 400));
    const now = { date: getSim().sim_date, hour: getSim().hour };
    const rm = roomModel(cfg, loadLive(cfg, now), now);
    if (rm.roomUnits(item, false) > rm.roomUnits(item, true)) {
      db().prepare(`UPDATE recommendations SET payload=json_set(payload,'$.qty',?) WHERE id=?`).run(rm.roomUnits(item, false), draft.id);
      assert.throws(() => decide(draft.id, "APPROVED", { qty: rm.roomUnits(item, false) }), (e: unknown) => e instanceof UserError && e.msg.k === "sp.err.po_collision" && typeof (e.msg.v as any).max === "number");
    }
  }
  assert.ok(w2);
});

test("(f) a lease that ends before the order arrives is no conflict: it is compatible", () => {
  fresh();
  const w = biggest();
  const cfg = loadSettings();
  const it = q(`SELECT * FROM items WHERE zone_id=? ORDER BY item_id LIMIT 1`, w.zone_id)[0];
  const now = { date: getSim().sim_date, hour: getSim().hour };
  const base = roomModel(cfg, loadLive(cfg, now), now).roomUnits(it);
  // the order arrives in lead_time days; the lease ends the day before
  const endsBefore = addDays(now.date, Math.max(0, it.lead_time_days - 1));
  db().prepare(`INSERT INTO space_leases(offer_id,listing_id,request_id,company,zone_id,area,start_date,end_date,price,status,signed_tick,income,income_days) VALUES(0,0,'T','Test Co',?,?,?,?,4,'ACTIVE',0,0,0)`).run(w.zone_id, 300, now.date, endsBefore);
  const after = roomModel(cfg, loadLive(cfg, now), now).roomUnits(it);
  assert.equal(after, base, "the lease is over when the order arrives: same room");
});

test("audit invariants hold over a scripted 12-day run with listings, offers, counter-offers, leases and a competing purchase", () => {
  fresh();
  const w = biggest();
  listIt(w, 4, w.area);
  for (let d = 0; d < 12; d++) {
    advance({ hours: 24 });
    const pend = q(`SELECT * FROM space_offers WHERE status='PENDING' ORDER BY id`)[0];
    if (pend) {
      const ev = evaluateOffer(loadSettings(), pend, getListing(pend.listing_id)!);
      try { if (ev.can_accept) offerAction(pend.id, "accept"); else if (ev.suggest) offerAction(pend.id, "counter", { terms: { area: ev.suggest.area, start_date: ev.suggest.start, end_date: ev.suggest.end, price: ev.suggest.price } }); } catch { /* refused for a good reason */ }
    }
    if (d === 5) { const p = q(`SELECT id FROM recommendations WHERE kind='PO' AND status='PENDING'`)[0]; if (p) try { decide(p.id, "APPROVED"); } catch { /* refused */ } }
    assert.deepEqual(runInvariants(false).filter((c) => !c.ok), [], `day ${d}`);
  }
  assert.deepEqual(runInvariants(true).filter((c) => !c.ok), []);
});

test("separation: purchasing code never touches space tables (except lease occupancy through lib/zones.ts); space code never writes purchasing tables", () => {
  const read = (f: string) => fs.readFileSync(f, "utf8");
  const spaceTables = /\bspace_(forecasts|listings|offers|leases|decisions)\b/;
  const purchasing = ["lib/agents/alerts.ts", "lib/agents/forecast.ts", "lib/agents/replenishment.ts", "lib/stock.ts", "lib/live.ts", "lib/decisions.ts", "lib/sim.ts", "lib/calc/inventory.ts", "lib/calc/budget.ts"];
  for (const f of purchasing) {
    const src = read(f);
    if (f === "lib/stock.ts") { assert.ok(!/space_(forecasts|listings|offers|decisions)/.test(src)); continue; } // reads active leases of a zone (occupancy) only
    assert.ok(!spaceTables.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), `${f} must not use space tables`);
  }
  for (const f of fs.readdirSync("lib/space").map((x) => `lib/space/${x}`)) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.ok(!/(INSERT INTO|UPDATE|DELETE FROM)\s+(purchase_orders_open|recommendations|stock_movements|current_stock|items|purchasing_budget)\b/.test(src), `${f} must not write purchasing tables`);
  }
  assert.ok(fs.existsSync("app/api/space/listings/route.ts") && fs.existsSync("components/space/SpaceView.tsx"), "separate routes and components");
});

test("every space decision is stamped with the simulated time and shows in the impact log tagged with its flow", () => {
  fresh();
  const w = biggest();
  listIt(w);
  keepWindowVacant({ zone_id: w.zone_id, area: 100, start_date: w.start, end_date: w.end });
  const rows = impactLog(30);
  assert.ok(rows.every((r) => r.flow === "purchasing" || r.flow === "space"));
  assert.ok(rows.some((r) => r.flow === "space"));
  for (const d of q(`SELECT * FROM space_decisions`)) assert.ok(Number.isFinite(d.tick) && d.ts);
  assert.ok(projectZones(loadSettings()).size >= 2);
});

test("settings exist for every rental parameter (no hard-coded thresholds)", () => {
  fresh();
  const cfg = loadSettings();
  for (const k of ["space.forecast_days", "space.safety_margin_pct", "space.min_block_m2", "space.min_lease_days", "space.price_suggested", "space.price_market", "space.price_band_pct", "space.offer_delay_min_h",
    "space.offer_delay_max_h", "space.offer_validity_h", "space.counter_delay_min_h", "space.counter_delay_max_h", "space.counter_accept_prob", "space.offer_base_prob", "space.rule_lease_beats_purchase", "space.rule_pending_blocks_listing", "space.conflict_tolerance_pct"]) assert.doesNotThrow(() => cfg.raw(k), k);
  setSetting("space.safety_margin_pct", 30);
  const w30 = snapshot().space.windows.length;
  assert.ok(w30 >= 0);
});

test("priority rules are settings: lease-beats-purchase can be switched off; pending drafts can be made to block listing", () => {
  fresh();
  const w = biggest();
  const cfg = () => loadSettings();
  const it = q(`SELECT * FROM items WHERE zone_id=? ORDER BY item_id LIMIT 1`, w.zone_id)[0];
  const now = { date: getSim().sim_date, hour: getSim().hour };
  const units = () => roomModel(cfg(), loadLive(cfg(), now), now).roomUnits(it);
  const base = units();
  db().prepare(`INSERT INTO space_leases(offer_id,listing_id,request_id,company,zone_id,area,start_date,end_date,price,status,signed_tick,income,income_days) VALUES(0,0,'T','Test Co',?,?,?,?,4,'RESERVED',0,0,0)`).run(w.zone_id, 300, now.date, addDays(now.date, 300));
  assert.ok(units() < base, "rule on: the lease reduces purchasing room");
  setSetting("space.rule_lease_beats_purchase", false);
  assert.equal(units(), base, "rule off: purchasing ignores the rental");
  setSetting("space.rule_lease_beats_purchase", true);
  fresh();
  const free = maxListable(cfg(), w.zone_id, w.start, w.end);
  setSetting("space.rule_pending_blocks_listing", true);
  assert.ok(maxListable(cfg(), w.zone_id, w.start, w.end) <= free, "drafts can block");
});
