import { db } from "../db";
import { addDays, diffDays } from "../time";
import { dayRate, freeWindows, listableArea, confidenceOf, type DemandModel, type SeasonCfg } from "../calc";
import { getSim, logRun, M, type AgentResult, type Item, type Msg, type Po } from "../core";
import { loadSettings, type Settings } from "../settings";
import { openPos } from "../live";
import { windowCfg, logSpaceEvent } from "./common";

export interface Driver { po_id: string; item_id: string; qty: number; area: number; arrival: string; pending: boolean; ordered: number }
export interface ZoneProj {
  zone_id: string; zone_name: string; storage_type: string; capacity: number; fixed: number; buffer: number;
  dates: string[]; need: number[]; needPending: number[]; leased: number[]; listed: number[]; drivers: Driver[];
}

/** Remaining area of a listing that is still on offer (area minus what was already leased from it). */
export const LISTING_REMAINING = `MAX(0, l.area - COALESCE((SELECT SUM(x.area) FROM space_leases x WHERE x.listing_id=l.id AND x.status IN ('RESERVED','ACTIVE','ENDED')), 0))`;

/**
 * Space the company itself will need, per rentable zone and per day, for the next `space.forecast_days` days:
 * fixed area + reserved buffer + the stock held there today, moved day by day by the forecast demand (the seasonal ramp of the
 * forecast agent) and by the purchase orders on the way (approved and in transit). `needPending` also counts the PO drafts nobody approved yet.
 * Stock beyond the home zone's capacity spills into the overflow zone, as receiving does.
 */
export function projectZones(cfg: Settings, o: { excludeListing?: number } = {}): Map<string, ZoneProj> {
  const d = db();
  const sim = getSim();
  const now = { date: sim.sim_date, hour: sim.hour };
  const H = cfg.n("space.forecast_days");
  const dates = Array.from({ length: H }, (_, k) => addDays(now.date, k));
  const overflow = cfg.s("space.overflow_zone");
  // light per-item state (the full live view also projects stock-outs, which the space forecast does not need)
  const season = cfg.j<SeasonCfg>("demand.season");
  const base = new Map((d.prepare(`SELECT item_id, base_weekly FROM forecasts`).all() as { item_id: string; base_weekly: number }[]).map((r) => [r.item_id, r.base_weekly]));
  const held = new Map((d.prepare(`SELECT item_id, SUM(quantity_on_hand) q FROM current_stock GROUP BY item_id`).all() as { item_id: string; q: number }[]).map((r) => [r.item_id, r.q]));
  const posBy = new Map<string, Po[]>();
  for (const p of openPos()) posBy.set(p.item_id, [...(posBy.get(p.item_id) ?? []), p]);
  const live = new Map((d.prepare(`SELECT * FROM items ORDER BY item_id`).all() as Item[]).map((item) => [item.item_id,
    { item, model: { itemId: item.item_id, baseWeekly: base.get(item.item_id) ?? 0, season } as DemandModel, onHand: held.get(item.item_id) ?? 0, pos: posBy.get(item.item_id) ?? [] }]));
  const zones = d.prepare(`SELECT * FROM warehouse_zones ORDER BY zone_id`).all() as
    { zone_id: string; zone_name: string; storage_type: string; capacity_m2: number; fixed_occupied_m2_aisles_equipment: number; reserved_buffer_m2: number; rent_allowed: string }[];
  const rentable = zones.filter((z) => z.rent_allowed === "yes").sort((a, b) => Number(a.zone_id === overflow) - Number(b.zone_id === overflow) || a.zone_id.localeCompare(b.zone_id));
  // stock area of the goods that belong to each zone (wherever the lots lie today: home zone or overflow)
  const stockNow = new Map((d.prepare(`SELECT i.zone_id z, SUM(c.quantity_on_hand*i.space_m2_per_unit) m FROM current_stock c JOIN items i ON i.item_id=c.item_id GROUP BY i.zone_id`).all() as { z: string; m: number }[]).map((r) => [r.z, r.m]));
  const drafts = (d.prepare(`SELECT payload FROM recommendations WHERE kind='PO' AND status='PENDING'`).all() as { payload: string }[]).map((r) => JSON.parse(r.payload) as { item_id: string; qty: number; expected_arrival: string });
  const leases = d.prepare(`SELECT zone_id, area, start_date, end_date FROM space_leases WHERE status IN ('RESERVED','ACTIVE')`).all() as { zone_id: string; area: number; start_date: string; end_date: string }[];
  const listings = d.prepare(`SELECT l.id, l.zone_id, ${LISTING_REMAINING} AS rest, l.start_date, l.end_date FROM space_listings l WHERE l.status IN ('DRAFT','PUBLISHED','PAUSED')`).all() as { id: number; zone_id: string; rest: number; start_date: string; end_date: string }[];

  // stock area of every item day by day: arrivals first, then the day's demand (first day: only the hours left)
  const delta = new Map<string, { committed: number[]; pending: number[] }>();
  const itemRun = (itemId: string, extra: { qty: number; arrival: string }[]) => {
    const l = live.get(itemId)!;
    const sp = l.item.space_m2_per_unit;
    let s = l.onHand;
    const out: number[] = [];
    const arr = [...l.pos.map((p) => ({ qty: p.quantity, arrival: p.expected_arrival })), ...extra];
    for (let k = 0; k < H; k++) {
      for (const a of arr) if (a.arrival === dates[k] || (k === 0 && a.arrival < dates[0])) s += a.qty;
      out.push((s - l.onHand) * sp);
      const rate = dayRate(l.model, dates[k]);
      s = Math.max(0, s - (k === 0 ? (rate * (24 - now.hour)) / 24 : rate));
    }
    return out;
  };
  const byZone = new Map<string, string[]>();
  for (const l of live.values()) byZone.set(l.item.zone_id, [...(byZone.get(l.item.zone_id) ?? []), l.item.item_id]);
  const drivers = new Map<string, Driver[]>();
  for (const [zone, ids] of byZone) {
    const c = new Array(H).fill(0), p = new Array(H).fill(0);
    for (const id of ids) {
      const base = itemRun(id, []);
      const withDrafts = itemRun(id, drafts.filter((x) => x.item_id === id).map((x) => ({ qty: x.qty, arrival: x.expected_arrival })));
      base.forEach((v, k) => (c[k] += v)); withDrafts.forEach((v, k) => (p[k] += v));
      const it = live.get(id)!.item;
      const ds = drivers.get(zone) ?? [];
      for (const po of live.get(id)!.pos) ds.push({ po_id: po.po_id, item_id: id, qty: po.quantity, area: po.quantity * it.space_m2_per_unit, arrival: po.expected_arrival, pending: false, ordered: po.ordered_tick ?? -1 });
      for (const x of drafts.filter((y) => y.item_id === id)) ds.push({ po_id: "", item_id: id, qty: x.qty, area: x.qty * it.space_m2_per_unit, arrival: x.expected_arrival, pending: true, ordered: Number.MAX_SAFE_INTEGER });
      drivers.set(zone, ds);
    }
    delta.set(zone, { committed: c, pending: p });
  }

  const out = new Map<string, ZoneProj>();
  const spill = { committed: new Array(H).fill(0), pending: new Array(H).fill(0) };
  for (const z of rentable) {
    const fixedBuf = z.fixed_occupied_m2_aisles_equipment + z.reserved_buffer_m2;
    const room = z.capacity_m2 - z.fixed_occupied_m2_aisles_equipment; // what receiving can fill
    const dz = delta.get(z.zone_id);
    const isOver = z.zone_id === overflow;
    const goods = (series: number[] | undefined, extra: number[]) => dates.map((_, k) => Math.max(0, (stockNow.get(z.zone_id) ?? 0) + (series?.[k] ?? 0) + (isOver ? extra[k] : 0)));
    const tC = goods(dz?.committed, spill.committed), tP = goods(dz?.pending, spill.pending);
    // goods that do not fit at home go to the overflow zone (this is what receiving does)
    if (!isOver) { tC.forEach((v, k) => (spill.committed[k] += Math.max(0, v - room))); tP.forEach((v, k) => (spill.pending[k] += Math.max(0, v - room))); }
    const need = tC.map((v) => Math.min(z.capacity_m2, fixedBuf + Math.min(v, room)));
    const needPending = tP.map((v) => Math.min(z.capacity_m2, fixedBuf + Math.min(v, room)));
    out.set(z.zone_id, {
      zone_id: z.zone_id, zone_name: z.zone_name, storage_type: z.storage_type, capacity: z.capacity_m2,
      fixed: z.fixed_occupied_m2_aisles_equipment, buffer: z.reserved_buffer_m2, dates, need, needPending,
      leased: dates.map((dt) => leases.filter((x) => x.zone_id === z.zone_id && x.start_date <= dt && dt < x.end_date).reduce((a, x) => a + x.area, 0)),
      listed: dates.map((dt) => listings.filter((x) => x.zone_id === z.zone_id && x.id !== o.excludeListing && x.start_date <= dt && dt < x.end_date).reduce((a, x) => a + x.rest, 0)),
      drivers: (drivers.get(z.zone_id) ?? []).sort((a, b) => b.area - a.area),
    });
  }
  return out;
}

/** Area still free of company need and leases on each day, no safety margin and no other listings (the hard limit). */
export const rawFree = (p: ZoneProj, k: number) => Math.max(0, p.capacity - p.need[k] - p.leased[k]);

/** Smallest of the daily series over [from, to). Days outside the horizon count as the last forecast day. */
export function minOver(p: ZoneProj, from: string, to: string, f: (k: number) => number): number {
  const last = p.dates.length - 1;
  let m = Infinity;
  for (let dt = from; dt < to; dt = addDays(dt, 1)) { const k = Math.min(last, Math.max(0, diffDays(dt, p.dates[0]))); m = Math.min(m, f(k)); }
  return m === Infinity ? 0 : m;
}

export const listableSeries = (p: ZoneProj, marginPct: number, pending = false) =>
  p.dates.map((_, k) => listableArea(p.capacity, pending ? p.needPending[k] : p.need[k], p.leased[k], p.listed[k], marginPct));

/** Largest area that can be listed in a zone for the whole period (margin applied, other listings subtracted). */
export function maxListable(cfg: Settings, zone: string, from: string, to: string, o: { excludeListing?: number } = {}): number {
  const p = projectZones(cfg, o).get(zone);
  if (!p) return 0;
  const m = cfg.n("space.safety_margin_pct"), block = cfg.b("space.rule_pending_blocks_listing");
  return Math.floor(minOver(p, from, to, (k) => listableArea(p.capacity, block ? p.needPending[k] : p.need[k], p.leased[k], p.listed[k], m)));
}

/** Largest area the forecast leaves free (no safety margin) for a listing's own period, other listings with a smaller id subtracted. */
export function maxListableRaw(cfg: Settings, zone: string, from: string, to: string, listingId: number): number {
  const p = projectZones(cfg, { excludeListing: listingId }).get(zone);
  if (!p) return 0;
  const earlier = (dt: string) => (db().prepare(`SELECT COALESCE(SUM(${LISTING_REMAINING}),0) a FROM space_listings l WHERE l.zone_id=? AND l.id<? AND l.status IN ('DRAFT','PUBLISHED','PAUSED') AND l.start_date<=? AND ?<l.end_date`).get(zone, listingId, dt, dt) as { a: number }).a;
  let m = Infinity;
  const last = p.dates.length - 1;
  for (let dt = from; dt < to; dt = addDays(dt, 1)) { const k = Math.min(last, Math.max(0, diffDays(dt, p.dates[0]))); m = Math.min(m, rawFree(p, k) - earlier(dt)); }
  return m === Infinity ? 0 : Math.max(0, Math.floor(m));
}

export interface WindowRow {
  zone_id: string; start_date: string; end_date: string; area: number; confidence: string; state: "NEW" | "HELD" | "BLOCKED" | "CONFLICT" | "WARN";
  held_until: string | null; to_horizon: number; pending_area: number; pending_note: string | null; inputs: Record<string, unknown>;
}

export type { Msg };
