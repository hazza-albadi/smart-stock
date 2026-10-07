import { db } from "./db";

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

export function setSetting(key: string, value: unknown) {
  const cur = db().prepare(`SELECT unit FROM settings WHERE key=?`).get(key) as { unit: string } | undefined;
  if (!cur) throw new Error(`unknown setting: ${key}`);
  if (["int", "ms", "h", "days", "weeks", "ratio", "x", "units/wk", "rows", "weight"].includes(cur.unit) && !Number.isFinite(Number(value))) throw new Error("number expected");
  db().prepare(`UPDATE settings SET value=? WHERE key=?`).run(JSON.stringify(value), key);
}
