import { db } from "./db";
import { M, UserError, type Msg } from "./core";

export interface SettingRow { key: string; value: unknown; unit: string; description: string }

/** Typed read access to the `settings` table (defaults seeded from config/defaults.json). */
export class Settings {
  constructor(private map: Map<string, SettingRow>) {}
  raw(key: string): unknown {
    const r = this.map.get(key);
    if (!r) throw new Error(`missing setting: ${key}`);
    return r.value;
  }
  n(key: string): number { return Number(this.raw(key)); }
  s(key: string): string { return String(this.raw(key)); }
  b(key: string): boolean { return Boolean(this.raw(key)); }
  j<T>(key: string): T { return this.raw(key) as T; }
  all(): SettingRow[] { return [...this.map.values()]; }
}

export function loadSettings(): Settings {
  const rows = db().prepare(`SELECT key, value, unit, description FROM settings ORDER BY rowid`).all() as
    { key: string; value: string; unit: string; description: string }[];
  return new Settings(new Map(rows.map((r) => [r.key, { ...r, value: JSON.parse(r.value) }])));
}

const kindOf = (v: unknown) => (Array.isArray(v) ? "list" : v === null ? "null" : typeof v === "boolean" ? "boolean" : typeof v === "number" ? "number" : typeof v === "string" ? "text" : "object");
/** Settings whose value may be negative (everything else numeric is a count, a duration, a rate or an amount). */
const MAY_BE_NEGATIVE = new Set(["sim.utc_offset_hours"]);
/** Settings that must be at least 1 (a zero would make a loop, a series or a division empty). */
const AT_LEAST_ONE = new Set(["space.forecast_days", "space.days_per_month", "budget.period_days", "forecast.horizon_weeks", "forecast.recent_weeks", "forecast.prior_weeks", "demand.baseline_days", "sim.max_advance_hours", "ui.feed_page_size", "ui.draft_page_size", "ui.agent_groups", "log.keep_agent_runs", "summary.keep", "space.max_layers", "space.offer_window_days", "delivery.retry_hours"]);

/**
 * Checks a new value against the stored one before it is saved: same kind (number, true/false, text, list, object), numbers finite and in range,
 * hours of the day 0-23, dates as YYYY-MM-DD. Root cause of SIM_REVIEW C1: a schedule typed as `6` instead of `[6]` was stored and every tick then threw.
 * Returns the message of the first problem, or null when the value is fine.
 */
export function settingProblem(key: string, value: unknown, current: unknown, unit: string): Msg | null {
  const want = kindOf(current), got = kindOf(value);
  if (want !== got) return M("settings.err.type", { key, kind: M(`settings.kind.${want}`) });
  const nums = (v: unknown): number[] => (typeof v === "number" ? [v] : Array.isArray(v) ? v.flatMap(nums) : v && typeof v === "object" ? Object.values(v).flatMap(nums) : []);
  if (nums(value).some((n) => !Number.isFinite(n))) return M("settings.err.type", { key, kind: M("settings.kind.number") });
  if (Array.isArray(current) && current.length && kindOf(current[0]) !== "object" && (value as unknown[]).some((x) => kindOf(x) !== kindOf(current[0]))) return M("settings.err.type", { key, kind: M("settings.kind.list") });
  if (unit === "hours" && (value as unknown[]).some((h) => !Number.isInteger(h) || (h as number) < 0 || (h as number) > 23)) return M("settings.err.hours", { key });
  if (unit === "date" && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))) return M("settings.err.date", { key });
  if (typeof value === "number") {
    const min = AT_LEAST_ONE.has(key) ? 1 : MAY_BE_NEGATIVE.has(key) ? -24 : 0;
    if (value < min) return M("settings.err.min", { key, min });
    if (MAY_BE_NEGATIVE.has(key) && value > 24) return M("settings.err.max", { key, max: 24 });
    const share = unit === "ratio" && /(_prob|_share)$/.test(key); // chances and shares are 0..1; other ratios (premiums, price factors) may be above 1
    if ((share && value > 1) || (unit === "pct" && value > 100)) return M("settings.err.max", { key, max: unit === "pct" ? 100 : 1 });
  }
  if (unit === "weight" && Array.isArray(value) && (value.length !== 24 || !(nums(value).reduce((a, b) => a + b, 0) > 0))) return M("settings.err.type", { key, kind: M("settings.kind.list") });
  return null;
}

/** Stores a setting after checking it; a wrong value is refused with a message in the user's language and nothing is stored. */
export function setSetting(key: string, value: unknown) {
  const cur = db().prepare(`SELECT value, unit FROM settings WHERE key=?`).get(key) as { value: string; unit: string } | undefined;
  if (!cur) throw new UserError(M("settings.err.unknown", { key }));
  const bad = settingProblem(key, value, JSON.parse(cur.value), cur.unit);
  if (bad) throw new UserError(bad);
  db().prepare(`UPDATE settings SET value=? WHERE key=?`).run(JSON.stringify(value), key);
}
