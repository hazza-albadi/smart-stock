import { addDays, diffDays } from "../time";
import { seasonFactor, type SeasonCfg } from "./season";

export interface Now { date: string; hour: number }
export interface DemandModel { itemId: string; baseWeekly: number; season: SeasonCfg }
export interface LotLite { quantity_on_hand: number; expiry_date: string | null }
export interface PoLite { expected_arrival: string; quantity: number }

export const NO_USAGE_COVER = 999; // cover shown as "99+" when there is no usage

export const dayRate = (m: DemandModel, date: string) => (m.baseWeekly / 7) * seasonFactor(m.season, m.itemId, date);

/** Forecast demand over the next `hours` hours (continuous: the rest of today counts only for its remaining hours). */
export function demandOver(m: DemandModel, now: Now, hours: number): number {
  let rem = hours, date = now.date, left = 24 - now.hour, total = 0;
  while (rem > 1e-9) {
    const take = Math.min(rem, left);
    total += (dayRate(m, date) * take) / 24;
    rem -= take; date = addDays(date, 1); left = 24;
  }
  return total;
}

/** Hours the on-hand stock lasts at the weekly usage (null when nothing is used). */
export const coverHours = (onHand: number, weeklyUsage: number) => (weeklyUsage > 0 ? (onHand / weeklyUsage) * 168 : null);

export const coverWeeks = (onHand: number, weeklyUsage: number) => (weeklyUsage > 0 ? onHand / weeklyUsage : NO_USAGE_COVER);

/**
 * demandOver(m, now, hours) for many horizons, sharing the day-by-day terms: the full days are summed once (in the same order, so the
 * result is bit-identical) and each query only adds its last partial day. Used where one item has many lots (cost grew with lots x days).
 */
export function demandCurve(m: DemandModel, now: Now): (hours: number) => number {
  const rate: number[] = [], left: number[] = [], prefix: number[] = [0], dates: string[] = [now.date];
  const day = (i: number) => {
    while (rate.length <= i) {
      const k = rate.length;
      if (k > 0) dates.push(addDays(dates[k - 1], 1));
      rate.push(dayRate(m, dates[k])); left.push(k === 0 ? 24 - now.hour : 24);
      prefix.push(prefix[k] + (rate[k] * left[k]) / 24);
    }
  };
  return (hours: number) => {
    let rem = hours, i = 0;
    for (;;) { day(i); if (rem - left[i] <= 1e-9) break; rem -= left[i]; i++; } // whole days before the last one
    if (rem <= 1e-9) return prefix[i];
    return rem >= left[i] ? prefix[i + 1] : prefix[i] + (rate[i] * rem) / 24; // take = min(rem, left), as in demandOver
  };
}

/** Stock that FEFO consumption will actually use before each lot expires (the rest would be written off). */
export function usableQty(m: DemandModel, now: Now, lots: LotLite[], lastUsableHour: number): number {
  const sorted = [...lots].filter((l) => l.quantity_on_hand > 0).sort((a, b) => (a.expiry_date ?? "9999").localeCompare(b.expiry_date ?? "9999"));
  let usable = 0, consumed = 0;
  const curve = demandCurve(m, now);
  for (const l of sorted) {
    if (!l.expiry_date) { usable += l.quantity_on_hand; continue; }
    const hours = Math.max(0, Math.min(diffDays(l.expiry_date, now.date) * 24 + lastUsableHour + 1 - now.hour, 400 * 24));
    const cum = curve(hours);
    const u = Math.min(l.quantity_on_hand, Math.max(0, cum - consumed));
    usable += u; consumed += u;
  }
  return usable;
}

export interface Stockout { date: string; days: number; hours: number }

/** Day-by-day projection with open POs; returns when usable stock reaches zero (null if not within `maxDays`). */
export function projectStockout(m: DemandModel, now: Now, usable: number, pos: PoLite[], maxDays: number): Stockout | null {
  let stock = usable;
  if (m.baseWeekly <= 0) return null;
  for (let i = 0; i < maxDays; i++) {
    const date = addDays(now.date, i);
    for (const p of pos) if (p.expected_arrival === date || (i === 0 && p.expected_arrival < date)) stock += p.quantity;
    const full = dayRate(m, date);
    const demand = i === 0 ? (full * (24 - now.hour)) / 24 : full;
    if (stock - demand <= 0) {
      const before = i === 0 ? 0 : 24 - now.hour + (i - 1) * 24;
      const hours = Math.max(0, before + (full > 0 ? (stock / full) * 24 : 0));
      return { date, days: i, hours };
    }
    stock -= demand;
  }
  return null;
}

export const poWithin = (pos: PoLite[], today: string, days: number) =>
  pos.filter((p) => diffDays(p.expected_arrival, today) <= days).reduce((a, p) => a + p.quantity, 0);

export interface StatusCfg { criticalCover: number; poSoonDays: number; lowCover: number; overstock: number }
export type Status = "Critical" | "Low" | "OK" | "Overstock" | "Expiring";

export function statusOf(p: { onHand: number; cover: number; safety: number; poSoon: boolean; expiring: boolean }, c: StatusCfg): Status {
  if (p.onHand <= 0 || (p.cover < c.criticalCover && !p.poSoon)) return "Critical";
  if (p.expiring) return "Expiring";
  if (p.cover < c.lowCover || p.onHand < p.safety) return "Low";
  if (p.cover > c.overstock) return "Overstock";
  return "OK";
}

export const reorderPoint = (m: DemandModel, now: Now, leadDays: number, reviewDays: number, safety: number) =>
  demandOver(m, now, (leadDays + reviewDays) * 24) + safety;

export function roundUpTo(q: number, step: number | undefined) { return step ? Math.ceil(q / step) * step : Math.ceil(q); }
