import { rand } from "../rng";

/** Stochastic rounding keeps integer quantities while preserving the mean (needed for slow movers). */
export const stochRound = (x: number, r: number) => Math.floor(x) + (r < x - Math.floor(x) ? 1 : 0);

/** Integer demand of one item for one day: baseline x multiplier x seeded noise (same rule as the original daily model). */
export function dailyQuantity(p: { base: number; mult: number; noise: number; seed: number; date: string; item: string }): number {
  const n = 1 + (rand(`${p.seed}|${p.date}|${p.item}|n`) * 2 - 1) * p.noise;
  return Math.max(0, stochRound(p.base * p.mult * n, rand(`${p.seed}|${p.date}|${p.item}|r`)));
}

/**
 * Spreads an integer daily quantity over 24 hours following the profile. Whole parts are exact; the few leftover units
 * are placed by seeded weighted draws, so the 24 amounts always sum exactly to `total` (nothing lost or created).
 */
export function hourlySplit(total: number, profile: number[], draw: (i: number) => number): number[] {
  const sum = profile.reduce((a, b) => a + b, 0);
  const w = profile.map((x) => x / sum);
  const out: number[] = w.map((x) => Math.floor(total * x + 1e-9));
  let rest = total - out.reduce((a, b) => a + b, 0);
  const frac: number[] = w.map((x, h) => total * x - out[h]);
  let i = 0;
  while (rest > 0) {
    const tot = frac.reduce((a, b) => a + b, 0) || 1;
    let target = draw(i++) * tot, h: number = 0;
    for (; h < 23; h++) { if (target < frac[h]) break; target -= frac[h]; }
    out[h] += 1; frac[h] = 0; rest -= 1;
    if (frac.every((f) => f <= 0)) for (let k = 0; k < frac.length; k++) frac[k] = 1;
  }
  return out;
}

/** Deterministic delivery hour inside the delivery window [start, end) for one PO. */
export const deliveryHour = (seed: number, poId: string, start: number, end: number): number =>
  start + Math.min(end - start - 1, Math.floor(rand(`${seed}|${poId}|dh`) * (end - start)));
