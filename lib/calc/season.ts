import { addDays, diffDays } from "../time";

export interface SeasonCfg { items: string[]; peak: number; ramp_start: string; ramp_days: number; season_end: string; decay_days: number }
export interface EventCfg { item: string; factor: number; start: string; hold_days: number; decay_days: number }

/** Seasonal index: 1 off-season, ramps to `peak` over `ramp_days` from ramp_start (MM-DD), holds until season_end, eases off. */
export function seasonFactor(cfg: SeasonCfg, itemId: string, date: string): number {
  if (!cfg.items.includes(itemId)) return 1;
  const year = Number(date.slice(0, 4));
  const mdOf = (md: string, y: number) => `${y}-${md}`;
  let start = mdOf(cfg.ramp_start, year);
  if (start > date) start = mdOf(cfg.ramp_start, year - 1);
  const t = diffDays(date, start);
  let endDate = mdOf(cfg.season_end, Number(start.slice(0, 4)));
  if (endDate < start) endDate = mdOf(cfg.season_end, Number(start.slice(0, 4)) + 1);
  const endT = diffDays(endDate, start);
  if (t <= endT) return 1 + (cfg.peak - 1) * Math.min(1, t / cfg.ramp_days);
  if (t <= endT + cfg.decay_days) return cfg.peak - (cfg.peak - 1) * Math.min(1, (t - endT - 1) / cfg.decay_days);
  return 1;
}

/** One-off demand event: full factor for `hold_days`, then linear ease-off over `decay_days`. */
export function eventFactor(events: EventCfg[], itemId: string, date: string): number {
  let f = 1;
  for (const e of events) {
    if (e.item !== itemId) continue;
    const k = diffDays(date, e.start);
    if (k < 0) continue;
    if (k < e.hold_days) f *= e.factor;
    else if (k < e.hold_days - 1 + e.decay_days) f *= e.factor - (e.factor - 1) * ((k - (e.hold_days - 1)) / e.decay_days);
  }
  return f;
}

export const demandMultiplier = (s: SeasonCfg, ev: EventCfg[], itemId: string, date: string) =>
  seasonFactor(s, itemId, date) * eventFactor(ev, itemId, date);

export { addDays };
