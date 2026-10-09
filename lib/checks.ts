// Shared checks. The hourly audit (lib/audit.ts) and the agents' own VERIFY stage (lib/agents/*) use the same functions, so a rule is written once.
import { db } from "./db";
import { maxListableRaw } from "./space/forecast";
import type { Settings } from "./settings";

export interface VCheck { name: string; ok: boolean; detail: string }

const all = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).all(...a) as T[];
const one = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).get(...a) as T;

export const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
export const fail = (rows: string[]) => (rows.length ? rows.slice(0, 5).join("; ") + (rows.length > 5 ? ` … (+${rows.length - 5})` : "") : "ok");
/** One named check from the list of problems it found (empty list = passed). */
export const vcheck = (name: string, bad: string[]): VCheck => ({ name, ok: bad.length === 0, detail: fail(bad) });

/** A zone is over capacity when the company's own need (fixed + stock) plus the leased area is more than the zone holds. */
export const exceedsCapacity = (need: number, leased: number, capacity: number) => need + leased > capacity + 1e-6;

/** Leased area + the company's own need never exceeds the zone capacity (unless a LEASE_OVER alert already shows it). */
export function capacityViolations(date: string): string[] {
  const out: string[] = [];
  for (const z of all(`SELECT w.zone_id, w.capacity_m2 c, w.fixed_occupied_m2_aisles_equipment f,
      COALESCE((SELECT SUM(x.quantity_on_hand*i.space_m2_per_unit) FROM current_stock x JOIN items i ON i.item_id=x.item_id WHERE x.zone_id=w.zone_id),0) st,
      COALESCE((SELECT SUM(area) FROM space_leases WHERE zone_id=w.zone_id AND status IN ('RESERVED','ACTIVE') AND start_date<=? AND ?<end_date),0) ls FROM warehouse_zones w`, date, date))
    if (exceedsCapacity(z.f + z.st, z.ls, z.c) && !one(`SELECT 1 FROM alerts WHERE key=? AND active=1`, `LEASE_OVER:${z.zone_id}`)) out.push(`${z.zone_id}: leased ${Math.round(z.ls)} + need ${Math.round(z.f + z.st)} > ${z.c}`);
  return out;
}

/** Listed area never exceeds what the forecast leaves free (otherwise a conflict must be flagged); a published listing has a publication time. */
export function listedAreaViolations(cfg: Settings, date: string): string[] {
  const out: string[] = [];
  const flagged = new Set(all(`SELECT inputs FROM space_forecasts WHERE state='CONFLICT'`).map((r) => JSON.parse(r.inputs).listing_id));
  for (const l of all(`SELECT * FROM space_listings WHERE status IN ('DRAFT','PUBLISHED','PAUSED')`)) {
    const rest = l.area - one(`SELECT COALESCE(SUM(area),0) a FROM space_leases WHERE listing_id=?`, l.id).a;
    const room = maxListableRaw(cfg, l.zone_id, l.start_date < date ? date : l.start_date, l.end_date, l.id);
    if (rest > room + (rest * cfg.n("space.conflict_tolerance_pct")) / 100 + 1e-6 && !flagged.has(l.id)) out.push(`listing ${l.id}: ${rest} m² listed, forecast leaves ${room}`);
    if (rest > 0 && l.status === "PUBLISHED" && l.published_tick === null) out.push(`listing ${l.id} published without a time`);
  }
  return out;
}

// ---------------------------------------------------------------- Forecast
/** No negative or NaN value in any forecast row, and every item has a forecast. */
export function forecastViolations(): string[] {
  const out: string[] = [];
  const bad = (v: unknown) => typeof v !== "number" || !Number.isFinite(v) || v < 0;
  for (const f of all(`SELECT * FROM forecasts`)) {
    for (const k of ["weekly_usage", "base_weekly", "prior12_avg", "last3_avg", "anomaly_ratio", "season_factor", "forecast_4w", "daily_forecast"]) if (bad(f[k])) out.push(`${f.item_id}: ${k} = ${f[k]}`);
    for (const w of JSON.parse(f.forecast_weeks) as number[]) if (bad(w)) { out.push(`${f.item_id}: weekly forecast ${w}`); break; }
  }
  for (const r of all(`SELECT item_id FROM items WHERE item_id NOT IN (SELECT item_id FROM forecasts)`)) out.push(`${r.item_id}: no forecast`);
  return out;
}

// ---------------------------------------------------------------- Replenishment
export interface DraftRow { item_id: string; unit: string; qty: number; cost: number; funding: string; within_limit: boolean; edited: boolean }
/**
 * Agent drafts: quantity above zero and a multiple of the unit's order step; the drafts that are funded stay within the free budget;
 * an emergency request stays within free budget + the emergency room; no draft exceeds the room its zone has when the order arrives.
 * (A quantity the manager edited is the manager's own responsibility and is not judged.)
 */
export function draftViolations(drafts: DraftRow[], o: { free: number; emergencyRoom: number; step: (unit: string) => number; roomUnits: (itemId: string) => number }): string[] {
  const out: string[] = [];
  let funded = 0;
  for (const d of drafts) {
    if (d.edited) continue;
    if (!(d.qty > 0)) out.push(`${d.item_id}: quantity ${d.qty}`);
    const step = o.step(d.unit);
    if (step > 0 && !near(Math.round(d.qty / step) * step, d.qty)) out.push(`${d.item_id}: ${d.qty} is not a multiple of ${step}`);
    if (d.funding === "FUNDED" || d.funding === "PARTIAL") funded += d.cost;
    if (d.funding === "NEEDS_EXTRA" && d.within_limit && d.cost > Math.max(0, o.free) + o.emergencyRoom + 1e-6) out.push(`${d.item_id}: cost ${d.cost} above free budget + emergency room`);
    if (d.qty > o.roomUnits(d.item_id) + 1e-9) out.push(`${d.item_id}: ${d.qty} ${d.unit} exceed the room of its zone (${o.roomUnits(d.item_id)})`);
  }
  if (funded > Math.max(0, o.free) + o.emergencyRoom + 1e-6) out.push(`funded drafts ${funded} above free budget + emergency room`);
  return out;
}

// ---------------------------------------------------------------- Space Optimization
export interface ZoneSpaceRow { zone_id: string; capacity: number; used: number; allocated: number; rentable: number }
/**
 * Stored zone figures: rentable never negative or NaN; a zone is never above its capacity because of the company's own stock.
 * (With a tenant inside, an overshoot is the LEASE_OVER case that the Space Forecast agent flags and checks.)
 */
export function zoneSpaceViolations(rows: ZoneSpaceRow[]): string[] {
  const out: string[] = [];
  for (const z of rows) {
    if (!Number.isFinite(z.rentable) || z.rentable < 0) out.push(`${z.zone_id}: rentable ${z.rentable}`);
    if (exceedsCapacity(z.used, z.allocated, z.capacity) && !(z.allocated > 0)) out.push(`${z.zone_id}: above capacity ${z.used} > ${z.capacity}`);
  }
  return out;
}

// ---------------------------------------------------------------- Alerts
export interface AlertRow { key: string; kind: string; severity: string; title: unknown; detail: unknown; ignore_msg: unknown }
const isMsg = (m: unknown): boolean => !!m && typeof m === "object" && typeof (m as { k?: unknown }).k === "string" && (m as { k: string }).k.length > 0;
/** Every active alert has a known kind and severity and its three messages (what / why / what if ignored); no active key twice. */
export function alertViolations(rows: AlertRow[], kinds: ReadonlySet<string>, severities: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of rows) {
    if (seen.has(a.key)) out.push(`${a.key}: duplicate`);
    seen.add(a.key);
    if (!kinds.has(a.kind)) out.push(`${a.key}: unknown kind ${a.kind}`);
    if (!severities.includes(a.severity)) out.push(`${a.key}: unknown severity ${a.severity}`);
    if (!isMsg(a.title)) out.push(`${a.key}: no what`);
    if (!Array.isArray(a.detail) || !a.detail.length || !a.detail.every(isMsg)) out.push(`${a.key}: no why`);
    if (!isMsg(a.ignore_msg)) out.push(`${a.key}: no if-ignored message`);
  }
  return out;
}
