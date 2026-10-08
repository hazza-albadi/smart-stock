// Pure formulas of the space-rental flow (no database). Every threshold is passed in from the settings table.

export interface WindowCfg { minBlock: number; minDays: number; step: number; maxLayers: number; startBuffer: number }
export interface FreeWindow { start: string; end: string; area: number; toHorizon: boolean }

const floorTo = (v: number, step: number) => (step > 0 ? Math.floor(v / step + 1e-9) * step : Math.floor(v));

/**
 * Free windows from a daily series of listable area. A window is a run of days where at least `minBlock` m² stay free;
 * its area is the minimum of the run (rounded down to `step`). The area is then peeled off and the rest of the series is searched
 * again, so a zone that is 500 m² free now and 900 m² free later gives a 500 m² window plus a 400 m² window for the later days.
 * A further layer that would start within `minDays` of an existing window is dropped (it would only be a near-duplicate).
 * `dates` are consecutive days; `end` is exclusive.
 */
export function freeWindows(dates: string[], free: number[], c: WindowCfg, nextDay: (d: string) => string): FreeWindow[] {
  const out: FreeWindow[] = [];
  const rem = free.map((v) => Math.max(0, v));
  const n = rem.length;
  for (let layer = 0; layer < c.maxLayers; layer++) {
    let found = false;
    let d = 0;
    while (d < n) {
      if (rem[d] < c.minBlock) { d++; continue; }
      let e = d, m = rem[d];
      while (e < n && rem[e] >= c.minBlock) { m = Math.min(m, rem[e]); e++; }
      // space that only becomes free in the future is forecast, not certain: the window starts a few days later than the forecast says
      if (d > 0 && c.startBuffer > 0) {
        const shifted = Math.min(d + c.startBuffer, Math.max(d, e - c.minDays));
        if (shifted > d) { d = shifted; m = Math.min(...rem.slice(d, e)); }
      }
      const area = floorTo(m, c.step);
      const nearStart = out.some((w) => Math.abs(Date.parse(w.start) - Date.parse(dates[d])) < c.minDays * 86400000);
      if (e - d >= c.minDays && area >= c.minBlock && !nearStart) {
        out.push({ start: dates[d], end: e === n ? nextDay(dates[n - 1]) : dates[e], area, toHorizon: e === n });
        for (let k = d; k < e; k++) rem[k] -= area;
        found = true;
      }
      d = e;
    }
    if (!found) break;
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || b.area - a.area);
}

/** Listable area on one day: what the company will not need (after the safety margin) minus what is leased or already listed. */
export const listableArea = (capacity: number, need: number, leased: number, listed: number, marginPct: number) =>
  Math.max(0, Math.floor(Math.max(0, capacity - need - leased) * (1 - marginPct / 100) - listed + 1e-9));

export const confidenceOf = (daysToEnd: number, highDays: number, mediumDays: number): "high" | "medium" | "low" =>
  daysToEnd <= highDays ? "high" : daysToEnd <= mediumDays ? "medium" : "low";

export interface MarketCfg { market: number; bandPct: number; baseProb: number; sensitivity: number; delayMin: number; delayMax: number }

/** price / market price. 1 = at market. */
export const priceLevel = (price: number, market: number) => (market > 0 ? price / market : 1);

/** Chance that a matching company sends an offer: 1 x base at or below the market price, falling to 0 as the price rises above the band. */
export function arrivalProbability(price: number, c: MarketCfg): number {
  const r = priceLevel(price, c.market), top = 1 + c.bandPct / 100;
  const f = r <= top ? 1 : Math.max(0, 1 - (r - top) * c.sensitivity);
  return Math.max(0, Math.min(1, c.baseProb * f));
}

/** Hours until a company reacts to a listing: a draw between the min and max delay, faster below the market price, slower above it. */
export function arrivalDelayHours(price: number, draw: number, c: MarketCfg): number {
  const r = priceLevel(price, c.market);
  const speed = r < 1 ? Math.max(0.4, 1 - (1 - r)) : 1 + Math.max(0, r - 1) * c.sensitivity;
  return Math.max(1, Math.round((c.delayMin + draw * (c.delayMax - c.delayMin)) * speed));
}

/** Price a company bids: never above the listing, around the market price (draw 0..1 gives -spread..+spread). */
export const bidPrice = (listingPrice: number, market: number, spreadPct: number, draw: number) =>
  Math.round(Math.min(listingPrice, market * (1 + ((draw * 2 - 1) * spreadPct) / 100)) * 1000) / 1000;

export interface CounterTerms { area: number; price: number }
/** Chance that a company accepts a counter-offer: lower for a higher price and for less area than it asked for. */
export function counterAcceptProbability(offer: CounterTerms, counter: CounterTerms, base: number, sensitivity: number): number {
  const priceUp = offer.price > 0 ? Math.max(0, counter.price / offer.price - 1) : 0;
  const areaShare = offer.area > 0 ? Math.min(1, counter.area / offer.area) : 1;
  const areaPenalty = areaShare >= 0.5 ? 1 - (1 - areaShare) * 0.5 : 0.5 * areaShare * 2 * 0.75;
  return Math.max(0, Math.min(1, base * Math.max(0, 1 - priceUp * sensitivity) * areaPenalty));
}

/** Rent for one day: price is per m2 per month; a month counts `daysPerMonth` days. */
export const dailyIncome = (area: number, pricePerMonth: number, daysPerMonth: number) => (daysPerMonth > 0 ? (area * pricePerMonth) / daysPerMonth : 0);
