import test from "node:test";
import assert from "node:assert/strict";
import {
  seasonFactor, eventFactor, hourlySplit, dailyQuantity, demandOver, usableQty, projectStockout, statusOf, zoneFigures, physicalRoom,
  budgetFigures, coverWeeks, leaseActive, leaseOverlaps, reorderPoint, roundUpTo, deliveryHour,
} from "../lib/calc";
import { addMonths } from "../lib/time";
import { clockAt, tickOf } from "../lib/clock";
import { num, omrNum, clock } from "../lib/format";
import { render } from "../lib/render";
import { rand } from "../lib/rng";
import { coverHours } from "../lib/calc";
import { duration } from "../lib/render";
import { share } from "../lib/store";

const season = { items: ["X"], peak: 2, ramp_start: "10-05", ramp_days: 10, season_end: "03-31", decay_days: 10 };
const profile = [0.2, 0.2, 0.2, 0.2, 0.2, 0.4, 1, 3, 6, 8, 9, 9, 6, 7, 9, 9, 8, 6, 3, 2, 1, 0.5, 0.3, 0.2];

test("seasonality ramps up, holds, eases off and is 1 for other items", () => {
  assert.equal(seasonFactor(season, "X", "2026-10-04"), 1);
  assert.equal(seasonFactor(season, "X", "2026-10-05"), 1);
  assert.equal(seasonFactor(season, "X", "2026-10-10"), 1.5);
  assert.equal(seasonFactor(season, "X", "2026-10-15"), 2);
  assert.equal(seasonFactor(season, "X", "2027-01-20"), 2);
  assert.equal(seasonFactor(season, "X", "2027-04-01"), 2);
  assert.equal(seasonFactor(season, "X", "2027-04-20"), 1);
  assert.equal(seasonFactor(season, "Y", "2027-01-20"), 1);
});

test("event factor holds then eases off linearly", () => {
  const ev = [{ item: "X", factor: 3, start: "2026-10-05", hold_days: 5, decay_days: 10 }];
  assert.equal(eventFactor(ev, "X", "2026-10-04"), 1);
  assert.equal(eventFactor(ev, "X", "2026-10-09"), 3);
  assert.equal(eventFactor(ev, "X", "2026-10-10"), 2.8);
  assert.equal(eventFactor(ev, "X", "2026-10-19"), 1);
  assert.equal(eventFactor(ev, "Y", "2026-10-06"), 1);
});

test("24 hourly amounts always sum exactly to the daily quantity (many totals and seeds)", () => {
  for (let total = 0; total <= 400; total++) {
    for (const seed of [1, 2, 3]) {
      const h = hourlySplit(total, profile, (i) => rand(`${seed}|${total}|${i}`));
      assert.equal(h.length, 24);
      assert.equal(h.reduce((a, b) => a + b, 0), total, `total ${total} seed ${seed}`);
      assert.ok(h.every((v) => Number.isInteger(v) && v >= 0));
    }
  }
});

test("hourly profile is heavier in working hours than at night", () => {
  const h = hourlySplit(1000, profile, (i) => rand(`p|${i}`));
  assert.ok(h[10] > h[2] * 10);
});

test("daily quantity is deterministic per seed and differs between seeds", () => {
  const a = dailyQuantity({ base: 50, mult: 1.2, noise: 0.2, seed: 42, date: "2026-10-06", item: "X" });
  const b = dailyQuantity({ base: 50, mult: 1.2, noise: 0.2, seed: 42, date: "2026-10-06", item: "X" });
  assert.equal(a, b);
  const seeds = new Set([1, 2, 3, 4, 5, 6].map((s) => dailyQuantity({ base: 50, mult: 1, noise: 0.3, seed: s, date: "2026-10-06", item: "X" })));
  assert.ok(seeds.size > 1);
});

const model = { itemId: "Y", baseWeekly: 70, season };

test("forecast demand over full days equals days × daily rate; the rest of today counts only its remaining hours", () => {
  assert.equal(demandOver(model, { date: "2026-08-01", hour: 0 }, 48), 20);
  assert.equal(demandOver(model, { date: "2026-08-01", hour: 12 }, 12), 5);
  assert.equal(demandOver(model, { date: "2026-08-01", hour: 18 }, 12), 5);
});

test("usable stock excludes what expires before it can be used", () => {
  const lots = [{ quantity_on_hand: 100, expiry_date: "2026-08-03" }];
  // 10/day, expires end of 3 Aug: 3 days of use from 1 Aug 00:00 = 30
  assert.equal(usableQty(model, { date: "2026-08-01", hour: 0 }, lots, 23), 30);
  assert.equal(usableQty(model, { date: "2026-08-01", hour: 0 }, [{ quantity_on_hand: 5, expiry_date: null }], 23), 5);
});

test("stock-out projection counts POs that arrive in time and returns days and hours", () => {
  const now = { date: "2026-08-01", hour: 0 };
  const so = projectStockout(model, now, 25, [], 30);
  assert.equal(so?.days, 2);
  assert.equal(Math.round(so!.hours), 60);
  assert.equal(projectStockout(model, now, 25, [{ expected_arrival: "2026-08-02", quantity: 1000 }], 30), null);
});

test("status rules", () => {
  const c = { criticalCover: 1, poSoonDays: 3, lowCover: 2, overstock: 20 };
  assert.equal(statusOf({ onHand: 0, cover: 0, safety: 5, poSoon: false, expiring: false }, c), "Critical");
  assert.equal(statusOf({ onHand: 5, cover: 0.5, safety: 5, poSoon: true, expiring: false }, c), "Low");
  assert.equal(statusOf({ onHand: 50, cover: 5, safety: 5, poSoon: false, expiring: true }, c), "Expiring");
  assert.equal(statusOf({ onHand: 50, cover: 25, safety: 5, poSoon: false, expiring: false }, c), "Overstock");
  assert.equal(statusOf({ onHand: 50, cover: 5, safety: 5, poSoon: false, expiring: false }, c), "OK");
  assert.equal(coverWeeks(170, 578.5).toFixed(2), "0.29");
  assert.equal(coverWeeks(10, 0), 999);
});

test("reorder point and rounding", () => {
  assert.equal(reorderPoint(model, { date: "2026-08-01", hour: 0 }, 5, 2, 20), 90);
  assert.equal(roundUpTo(1234, 10), 1240);
  assert.equal(roundUpTo(12.2, undefined), 13);
});

test("zone figures: used = fixed + stock; rentable = capacity - used - buffer (only where rent is allowed)", () => {
  const z = zoneFigures({ capacity: 4000, fixed: 540, stockUsed: 2460, reserved: 500, rentAllowed: true, allocatedNow: 0 });
  assert.equal(z.used, 3000); assert.equal(z.rentableNet, 500); assert.equal(z.overCapacity, 0);
  const locked = zoneFigures({ capacity: 1000, fixed: 144, stockUsed: 656, reserved: 0, rentAllowed: false, allocatedNow: 0 });
  assert.equal(locked.rentableNet, 0); assert.equal(locked.notRentable, 200);
  assert.equal(zoneFigures({ capacity: 100, fixed: 10, stockUsed: 120, reserved: 0, rentAllowed: true, allocatedNow: 0 }).rentableNet, 0);
  assert.equal(zoneFigures({ capacity: 4000, fixed: 540, stockUsed: 2460, reserved: 500, rentAllowed: true, allocatedNow: 450 }).rentableNet, 50);
  assert.equal(physicalRoom({ capacity: 100, fixed: 10, stockUsed: 50, tenantsActive: 20 }), 20);
});

test("budget: committed = value of all POs, free = total - committed, over-budget flagged", () => {
  const b = budgetFigures(1000, [{ quantity: 10, unit_cost: 5 }, { quantity: 4, unit_cost: 10, premium: 0.5 }], 100);
  assert.equal(b.committed, 110); assert.equal(b.free, 890); assert.equal(b.afterDrafts, 790); assert.equal(b.overBudget, false);
  assert.equal(budgetFigures(100, [{ quantity: 10, unit_cost: 11 }]).overBudget, true);
});

test("leases cover [start, end)", () => {
  const l = { start_date: "2026-11-01", end_date: "2027-05-01", area: 600 };
  assert.ok(!leaseActive(l, "2026-10-31")); assert.ok(leaseActive(l, "2026-11-01")); assert.ok(!leaseActive(l, "2027-05-01"));
  assert.ok(leaseOverlaps(l, "2027-04-30", "2027-06-01")); assert.ok(!leaseOverlaps(l, "2027-05-01", "2027-06-01"));
  assert.equal(addMonths("2026-11-01", 6), "2027-05-01"); assert.equal(addMonths("2026-08-31", 6), "2027-02-28");
});

test("clock is an integer tick; day boundary is hour 0", () => {
  assert.deepEqual(clockAt("2026-10-05", 0), { tick: 0, day: 0, hour: 0, date: "2026-10-05" });
  assert.deepEqual(clockAt("2026-10-05", 47), { tick: 47, day: 1, hour: 23, date: "2026-10-06" });
  assert.equal(tickOf("2026-10-05", "2026-10-07", 14), 62);
  assert.ok(deliveryHour(1, "PO-1", 8, 16) >= 8 && deliveryHour(1, "PO-1", 8, 16) < 16);
});

test("formatting never prints NaN, Infinity or -0 and numerals follow the language", () => {
  for (const bad of [NaN, Infinity, -Infinity]) assert.equal(num("en", bad), "—");
  assert.equal(num("en", -0), "0"); assert.equal(num("en", -0.0004, 2), "0.00");
  assert.equal(num("en", 1234567.891, 1), "1,234,567.9");
  assert.match(num("ar", 1234), /[٠-٩]/);
  assert.equal(omrNum("en", 3988.5), "3,988.500");
  assert.equal(clock("en", 7), "07:00");
});

test("messages render in both languages with localized numerals", () => {
  const m = { k: "ev.stockout", v: { item: "X" } };
  assert.match(render("en", m, { items: { X: { name_en: "Frozen shells", name_ar: "قشور" } } }), /Frozen shells/);
  assert.match(render("ar", m, { items: { X: { name_en: "Frozen shells", name_ar: "قشور" } } }), /قشور/);
  assert.match(render("ar", { k: "alert.stockout.title", v: { hours: 5, item: "X" } }), /٥ ساعات/);
  assert.match(render("en", { k: "alert.stockout.title", v: { hours: 5, item: "X" } }), /about 5 hours/);
  assert.match(render("en", { k: "alert.stockout.title", v: { hours: 49, item: "X" } }), /about 2 days/);
  assert.match(render("ar", { k: "alert.stockout.title", v: { hours: 49, item: "X" } }), /يومين/);
});

test("duration speaks plain words in both languages", () => {
  assert.equal(duration("en", 0.4), "less than an hour");
  assert.equal(duration("en", 1), "1 hour");
  assert.equal(duration("en", 7), "7 hours");
  assert.equal(duration("en", 72), "3 days");
  assert.equal(duration("en", 24 * 20), "3 weeks");
  assert.equal(duration("ar", 7), "٧ ساعات");
  assert.equal(duration("ar", 11), "١١ ساعة");
  assert.equal(duration("en", null), "an unknown time");
  assert.equal(coverHours(170, 578.5)?.toFixed(1), "49.4");
  assert.equal(coverHours(10, 0), null);
});

test("structural sharing keeps the identity of unchanged parts (so only changed panels re-render)", () => {
  const a: any = { sim: { tick: 1 }, items: [{ id: 1, q: 5 }, { id: 2, q: 7 }], recs: [{ id: 9 }] };
  const b: any = { sim: { tick: 2 }, items: [{ id: 1, q: 5 }, { id: 2, q: 8 }], recs: [{ id: 9 }] };
  const c = share(a, b);
  assert.equal(c.recs, a.recs);
  assert.equal(c.items[0], a.items[0]);
  assert.notEqual(c.items[1], a.items[1]);
  assert.equal(c.sim.tick, 2);
  assert.equal(share(a, JSON.parse(JSON.stringify(a))), a);
});

// ---------------------------------------------------------------- rental formulas (lib/calc/rental.ts)
import { freeWindows, listableArea, confidenceOf, arrivalProbability, arrivalDelayHours, bidPrice, counterAcceptProbability, dailyIncome } from "../lib/calc";
import { addDays as addDay } from "../lib/time";

const days = (n: number, from = "2026-10-05") => Array.from({ length: n }, (_, i) => addDay(from, i));
const wc = { minBlock: 100, minDays: 14, step: 10, maxLayers: 4, startBuffer: 0 };

test("free windows: a constant free area is one window; the area is the lowest day, rounded down", () => {
  const w = freeWindows(days(60), new Array(60).fill(537), wc, (d) => addDay(d, 1));
  assert.deepEqual(w.map((x) => [x.start, x.end, x.area, x.toHorizon]), [["2026-10-05", "2026-12-04", 530, true]]);
});

test("free windows: space that frees up later gives a stacked second window; short or small periods are dropped", () => {
  const free = [...new Array(20).fill(500), ...new Array(40).fill(900)];
  const w = freeWindows(days(60), free, { ...wc, minDays: 14 }, (d) => addDay(d, 1));
  assert.equal(w[0].area, 500);
  assert.ok(w.some((x) => x.area === 400 && x.start === "2026-10-25"), "the extra 400 m2 from day 20");
  assert.equal(freeWindows(days(10), new Array(10).fill(900), wc, (d) => addDay(d, 1)).length, 0, "shorter than the minimum lease");
  assert.equal(freeWindows(days(60), new Array(60).fill(90), wc, (d) => addDay(d, 1)).length, 0, "smaller than the minimum block");
});

test("free windows: space that only frees up in the future starts a few days later (forecast error buffer)", () => {
  const free = [...new Array(10).fill(0), ...new Array(50).fill(400)];
  const [w] = freeWindows(days(60), free, { ...wc, startBuffer: 3 }, (d) => addDay(d, 1));
  assert.equal(w.start, addDay("2026-10-05", 13));
  const [now] = freeWindows(days(60), new Array(60).fill(400), { ...wc, startBuffer: 3 }, (d) => addDay(d, 1));
  assert.equal(now.start, "2026-10-05", "space free today is not delayed");
});

test("listable area: capacity - need - leased, safety margin applied, minus what is already listed", () => {
  assert.equal(listableArea(1000, 400, 100, 0, 10), 450);
  assert.equal(listableArea(1000, 400, 100, 200, 10), 250);
  assert.equal(listableArea(1000, 950, 100, 0, 10), 0);
  assert.equal(confidenceOf(10, 30, 60), "high"); assert.equal(confidenceOf(45, 30, 60), "medium"); assert.equal(confidenceOf(90, 30, 60), "low");
});

test("market model: price above the band lowers the chance and delays offers; below the market speeds them up; bids never exceed the listing", () => {
  const m = { market: 4, bandPct: 20, baseProb: 0.9, sensitivity: 2, delayMin: 24, delayMax: 96 };
  assert.equal(arrivalProbability(4, m), 0.9);
  assert.equal(arrivalProbability(4.8, m), 0.9, "inside the band");
  assert.ok(arrivalProbability(5.6, m) < 0.9 && arrivalProbability(5.6, m) > 0);
  assert.equal(arrivalProbability(12, m), 0);
  assert.ok(arrivalDelayHours(2.4, 0.5, m) < arrivalDelayHours(4, 0.5, m) && arrivalDelayHours(4, 0.5, m) < arrivalDelayHours(6, 0.5, m));
  for (const d of [0, 0.3, 0.7, 1]) assert.ok(bidPrice(3.5, 4, 10, d) <= 3.5);
  assert.ok(counterAcceptProbability({ area: 500, price: 4 }, { area: 500, price: 4 }, 0.7, 2) === 0.7);
  assert.ok(counterAcceptProbability({ area: 500, price: 4 }, { area: 500, price: 4.4 }, 0.7, 2) < 0.7);
  assert.ok(counterAcceptProbability({ area: 500, price: 4 }, { area: 250, price: 4 }, 0.7, 2) < 0.7);
});

test("rent per day = area x price per month / days per month", () => {
  assert.equal(dailyIncome(600, 4, 30), 80);
  assert.equal(dailyIncome(500, 4, 0), 0);
});
