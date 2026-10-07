import { diffDays } from "./time";

// Business knowledge about demand shape (not data): Oct-Mar peak season for these SKUs.
export const SEASONAL_ITEMS = ["SKU-001", "SKU-006", "SKU-017"];
export const SEASON_PEAK = 1.8;

/** Seasonal index: 1.0 off-season, ramps to 1.8 over two weeks from 5 Oct, holds until 31 Mar, eases off in April. */
export function seasonFactor(itemId: string, date: string): number {
  if (!SEASONAL_ITEMS.includes(itemId)) return 1;
  const m = +date.slice(5, 7);
  const d = +date.slice(8, 10);
  if (m === 10) {
    if (d < 5) return 1;
    return 1 + (SEASON_PEAK - 1) * Math.min(1, (d - 5) / 14);
  }
  if (m >= 11 || m <= 3) return SEASON_PEAK;
  if (m === 4) return SEASON_PEAK - (SEASON_PEAK - 1) * Math.min(1, (d - 1) / 14);
  return 1;
}

/** One-off demand event: SKU-019 label spike (~3x) continues a few more days, then eases off. */
export function spikeFactor(itemId: string, date: string): number {
  if (itemId !== "SKU-019") return 1;
  const k = diffDays(date, "2026-10-05"); // 0 = today in the data
  if (k < 0) return 1;
  if (k <= 4) return 3;
  if (k <= 14) return 3 - 2 * ((k - 4) / 10);
  return 1;
}

export const demandMultiplier = (itemId: string, date: string) =>
  seasonFactor(itemId, date) * spikeFactor(itemId, date);
