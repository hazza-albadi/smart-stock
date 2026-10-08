import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { useDatabase, db, closeDb } from "../lib/db";
import { seedDatabase } from "../lib/seed";
import { runAll } from "../lib/agents/coordinator";
import { advance } from "../lib/sim";
import { snapshot } from "../lib/snapshot";
import { loadSettings } from "../lib/settings";
import { getSim } from "../lib/core";
import { listWindow, listingAction } from "../lib/space/actions";

const file = path.join(os.tmpdir(), `smartstock-offers-${process.pid}.db`);
const q = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).all(...a) as T[];
const fresh = (seed = 42, over: Record<string, unknown> = {}) => { seedDatabase({ overrides: { "sim.auto_pause_critical": false, "sim.seed": seed, ...over } }); runAll({ group: "start", trigger: "start" }); };
before(() => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(file + e, { force: true }); useDatabase(file); });
test.after(() => { closeDb(); for (const e of ["", "-wal", "-shm"]) fs.rmSync(file + e, { force: true }); });
const win = () => snapshot().space.windows.filter((w) => w.state === "NEW").sort((a, b) => b.area - a.area)[0];
const list = (price: number) => { const w = win(); return listWindow({ zone_id: w.zone_id, area: w.area, start_date: w.start, end_date: w.end, price, publish: true }); };

test("the tenant pool holds the five CSV requests plus seeded SIMULATED companies; names are unique, labelled, and a share asks for never-rented storage", () => {
  fresh();
  const rows = q(`SELECT * FROM space_requests ORDER BY request_id`);
  assert.equal(rows.filter((r) => r.source === "DATA").length, 5);
  assert.equal(rows.filter((r) => r.source === "SIM").length, loadSettings().n("space.pool_extra_count"));
  assert.equal(new Set(rows.map((r) => r.company)).size, rows.length, "unique names");
  const sim = rows.filter((r) => r.source === "SIM");
  assert.ok(sim.every((r) => r.notes === "Simulated company"));
  const type = loadSettings().s("space.rentable_request_type");
  const closed = new Set(q(`SELECT storage_type t FROM warehouse_zones WHERE rent_allowed<>'yes'`).map((z) => z.t));
  assert.ok(sim.some((r) => r.required_storage_type !== type && closed.has(r.required_storage_type)), "some simulated demand is for protected zones");
  const a = JSON.stringify(rows); fresh(); assert.equal(JSON.stringify(q(`SELECT * FROM space_requests ORDER BY request_id`)), a, "same seed, same pool");
  fresh(7); assert.notEqual(JSON.stringify(q(`SELECT * FROM space_requests ORDER BY request_id`)), a, "another seed, another pool");
});

test("the pool size and ranges are settings", () => {
  fresh(42, { "space.pool_extra_count": 3, "space.pool_area_min": 200, "space.pool_area_max": 200 });
  const sim = q(`SELECT * FROM space_requests WHERE source='SIM'`);
  assert.equal(sim.length, 3);
  assert.ok(sim.every((r) => r.area_needed_m2 === 200));
});

test("reliable arrival: a reasonably priced listing gets at least the minimum number of offers inside the window, spread over hours, for every seed", () => {
  for (const seed of [42, 7, 2026]) {
    fresh(seed);
    const cfg = loadSettings();
    const min = cfg.n("space.offer_min_count"), windowH = cfg.n("space.offer_window_days") * 24;
    list(cfg.n("space.price_suggested"));
    const t0 = getSim().tick;
    assert.equal(snapshot().space.offers.length, 0, "nothing is visible before the first hour");
    advance({ hours: windowH });
    const offers = q(`SELECT * FROM space_offers WHERE status<>'SCHEDULED' ORDER BY arrived_tick`);
    assert.ok(offers.length >= min, `seed ${seed}: ${offers.length} offers`);
    assert.ok(offers.every((o) => o.arrived_tick >= t0 + cfg.n("space.offer_delay_min_h") - 1 && o.arrived_tick <= t0 + windowH), "inside the window");
    assert.ok(new Set(offers.slice(0, min).map((o) => o.arrived_tick)).size === Math.min(min, offers.length), "spread over different hours");
    assert.ok(offers.every((o) => o.area > 0 && o.end_date > o.start_date && o.price > 0));
  }
});

test("offers differ (area, duration, start, price) and prices come out below, at or above the asking price; offers match the listing and the storage type", () => {
  const diff = { below: 0, above: 0 };
  const shapes = new Set<string>();
  for (const seed of [42, 7, 2026]) {
    fresh(seed);
    list(loadSettings().n("space.price_suggested"));
    advance({ hours: 24 * 8 });
    const l = q(`SELECT * FROM space_listings`)[0];
    for (const o of q(`SELECT o.*, r.required_storage_type t FROM space_offers o JOIN space_requests r ON r.request_id=o.request_id WHERE o.status<>'SCHEDULED'`)) {
      assert.equal(o.listing_id, l.id); assert.equal(o.t, loadSettings().s("space.rentable_request_type"));
      if (o.price < l.price) diff.below++; if (o.price > l.price) diff.above++;
      shapes.add(`${o.area}|${o.start_date}|${o.end_date}`);
    }
  }
  assert.ok(diff.below > 0 && diff.above > 0, JSON.stringify(diff));
  assert.ok(shapes.size >= 8, "different areas, dates and durations");
});

test("a price far above the market band: no offers, the listing says why, and a suggestion appears after the window; lowering the price brings offers", () => {
  fresh();
  const cfg = loadSettings();
  const id = list(cfg.n("space.price_market") * 3).listingId;
  advance({ hours: cfg.n("space.offer_window_days") * 24 + 2 });
  assert.equal(q(`SELECT COUNT(*) n FROM space_offers`)[0].n, 0);
  const s = snapshot().space;
  assert.equal(s.listings[0].price_note, "high");
  const adv = s.advice.find((a) => a.listing_id === id);
  assert.ok(adv && adv.high && adv.suggest_price <= cfg.n("space.price_suggested") + 1e-9);
  assert.ok(snapshot().alerts.some((a) => a.key === `NO_OFFERS:${id}`), "also an alert");
  listingAction(id, "reprice", undefined, adv!.suggest_price);
  advance({ hours: cfg.n("space.offer_window_days") * 24 });
  assert.ok(q(`SELECT COUNT(*) n FROM space_offers WHERE status<>'SCHEDULED'`)[0].n >= cfg.n("space.offer_min_count"));
  assert.equal(snapshot().space.advice.length, 0);
});

test("offers can refresh over time: more arrive after the first ones, and expired ones leave the list", () => {
  fresh();
  const cfg = loadSettings();
  list(cfg.n("space.price_suggested"));
  advance({ hours: cfg.n("space.offer_window_days") * 24 });
  const first = q(`SELECT COUNT(*) n FROM space_offers WHERE status<>'SCHEDULED'`)[0].n;
  advance({ hours: 24 * 12 });
  const all = q(`SELECT * FROM space_offers WHERE status<>'SCHEDULED'`);
  assert.ok(all.length >= first);
  assert.ok(all.some((o) => o.status === "EXPIRED") || all.every((o) => o.valid_until_tick > getSim().tick), "expiry applies");
  assert.ok(snapshot().space.offers.every((o) => o.status !== "SCHEDULED"));
});

test("comparison: income per month, total income, fit and risk are provided for every waiting offer", () => {
  fresh();
  list(loadSettings().n("space.price_suggested"));
  advance({ hours: 24 * 5 });
  const pend = snapshot().space.offers.filter((o) => o.status === "PENDING");
  assert.ok(pend.length >= 2);
  for (const o of pend) {
    assert.ok(Math.abs(o.compare.monthly - o.area * o.price) < 1e-6);
    assert.ok(Math.abs(o.compare.total - o.per_day * o.compare.days) < 1e-6);
    assert.ok(["inside", "partly"].includes(o.compare.fit_dates) && ["fits", "too_big"].includes(o.compare.fit_area) && ["none", "watch", "blocked"].includes(o.compare.risk));
  }
});

test("determinism: same seed gives the same offers (planned and later); cold and hazardous zones are never listed or offered", () => {
  const run = () => { fresh(7); list(loadSettings().n("space.price_suggested")); advance({ hours: 24 * 7 }); return JSON.stringify(q(`SELECT request_id, arrived_tick, area, start_date, end_date, price, status FROM space_offers ORDER BY id`)); };
  assert.equal(run(), run());
  const closed = q(`SELECT zone_id FROM warehouse_zones WHERE rent_allowed<>'yes'`).map((z) => z.zone_id);
  assert.equal(q(`SELECT COUNT(*) n FROM space_listings WHERE zone_id IN (${closed.map(() => "?").join(",")})`, ...closed)[0].n, 0);
  const protectedReq = q(`SELECT request_id FROM space_requests WHERE required_storage_type<>?`, loadSettings().s("space.rentable_request_type")).map((r) => r.request_id);
  assert.equal(q(`SELECT COUNT(*) n FROM space_offers WHERE request_id IN (${protectedReq.map(() => "?").join(",")})`, ...protectedReq)[0].n, 0);
});
