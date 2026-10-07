import fs from "node:fs";
import path from "node:path";
import { db, SCHEMA } from "./db";
import { parseCsv } from "./csv";
import { addDays } from "./time";
import { loadSettings, type SettingRow } from "./settings";
import { deliveryHour } from "./calc";
import { M } from "./core";

const root = () => process.cwd();
const read = (f: string) => parseCsv(fs.readFileSync(path.join(root(), "smartstock_data", f), "utf8"));
const num = (v: string) => (v === "" ? null : Number(v));

export function defaultSettings(): SettingRow[] {
  return JSON.parse(fs.readFileSync(path.join(root(), "config", "defaults.json"), "utf8"));
}

/**
 * Drops and recreates every table from the CSV files and config/defaults.json. Used by `npm run seed` and the Reset button.
 * `keepSettings` keeps the values the user edited (speed, auto-pause ...); `overrides` forces specific settings (audit seeds).
 */
export function seedDatabase(o: { keepSettings?: boolean; overrides?: Record<string, unknown> } = {}) {
  const d = db();
  let previous: Record<string, unknown> = {};
  if (o.keepSettings) {
    try { previous = Object.fromEntries(loadSettings().all().map((r) => [r.key, r.value])); } catch { /* first run */ }
  }
  d.exec(SCHEMA);

  const ins = (table: string, rows: Record<string, unknown>[]) => {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const st = d.prepare(`INSERT INTO ${table}(${cols.join(",")}) VALUES(${cols.map((c) => "@" + c).join(",")})`);
    for (const r of rows) st.run(r);
  };

  d.transaction(() => {
    const defs = defaultSettings();
    const st = d.prepare(`INSERT INTO settings(key,value,unit,description) VALUES(?,?,?,?)`);
    for (const s of defs) {
      const v = o.overrides && s.key in o.overrides ? o.overrides[s.key] : s.key in previous ? previous[s.key] : s.value;
      st.run(s.key, JSON.stringify(v), s.unit, s.description);
    }
    const cfg = loadSettings();
    const seed = cfg.n("sim.seed");

    ins("items", read("items.csv").map((r) => ({
      ...r, unit_cost_omr: +r.unit_cost_omr, lead_time_days: +r.lead_time_days, safety_stock: +r.safety_stock,
      shelf_life_days: num(r.shelf_life_days), space_m2_per_unit: +r.space_m2_per_unit,
    })));
    ins("suppliers", read("suppliers.csv").map((r) => ({ ...r, typical_lead_time_days: +r.typical_lead_time_days })));
    ins("stock_movements", read("stock_movements.csv").map((r) => ({
      movement_id: r.movement_id, date: r.date, item_id: r.item_id, movement_type: r.movement_type,
      quantity: +r.quantity, reference: r.reference, balance_after: null, sim: 0, tick: null, lot_id: null, actor: "history",
    })));
    const lots: Record<string, any>[] = read("current_stock.csv").map((r) => ({ ...r, quantity_on_hand: +r.quantity_on_hand, expiry_date: r.expiry_date || null }));
    ins("current_stock", lots);
    ins("stock_opening", lots.map((l) => ({ lot_id: l.lot_id, item_id: l.item_id, qty: l.quantity_on_hand })));
    const ws = cfg.n("delivery.window_start_hour"), we = cfg.n("delivery.window_end_hour");
    ins("purchase_orders_open", read("purchase_orders_open.csv").map((r) => ({
      ...r, quantity: +r.quantity, source: "DATA", received_date: null, expected_hour: deliveryHour(seed, r.po_id, ws, we),
      ordered_tick: null, received_tick: null, emergency: 0, premium: 0, rec_key: null,
    })));
    ins("purchasing_budget", read("purchasing_budget.csv").map((r) => ({ ...r, total_purchasing_budget_omr: +r.total_purchasing_budget_omr })));
    ins("warehouse_zones", read("warehouse_zones.csv").map((r) => ({
      ...r, capacity_m2: +r.capacity_m2, fixed_occupied_m2_aisles_equipment: +r.fixed_occupied_m2_aisles_equipment,
      reserved_buffer_m2: +r.reserved_buffer_m2,
    })));
    ins("space_requests", read("space_requests.csv").map((r) => ({
      ...r, area_needed_m2: +r.area_needed_m2, duration_months: +r.duration_months, source: "DATA", created_tick: 0,
    })));

    // Last day with history data; the simulation starts after it.
    const historyEnd = (d.prepare(`SELECT MAX(date) m FROM stock_movements`).get() as { m: string }).m;

    // Baseline daily usage per item from history (items with a demand event: the weeks before the event).
    const evItems = new Set(cfg.j<{ item: string }[]>("demand.events").map((e) => e.item));
    const eb = cfg.j<{ exclude_recent_days: number; window_days: number }>("demand.event_baseline");
    const bdays = cfg.n("demand.baseline_days");
    const sum = d.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM stock_movements WHERE item_id=? AND movement_type='OUT'
      AND reference!='EXPIRED' AND date BETWEEN ? AND ?`);
    const bi = d.prepare(`INSERT INTO sim_baseline VALUES(?,?)`);
    for (const { item_id } of d.prepare(`SELECT item_id FROM items`).all() as { item_id: string }[]) {
      const ev = evItems.has(item_id);
      const days = ev ? eb.window_days : bdays;
      const to = ev ? addDays(historyEnd, -eb.exclude_recent_days) : historyEnd;
      const from = addDays(to, -(days - 1));
      bi.run(item_id, (sum.get(item_id, from, to) as { q: number }).q / days);
    }

    const start = cfg.s("sim.start_date");
    d.prepare(`INSERT INTO sim_state(id,tick,sim_date,start_date,history_end,data_end,running,interval_ms,last_tick_at) VALUES(1,0,?,?,?,?,0,?,0)`)
      .run(start, start, historyEnd, historyEnd, cfg.n("sim.interval_ms"));
    d.prepare(`INSERT INTO events(tick,ts,sim_date,type,item_id,severity,msg,actor) VALUES(0,?,?,?,?,?,?,?)`)
      .run(new Date().toISOString(), start, "SYSTEM", null, "info", JSON.stringify(M("ev.sim_ready", { date: start })), "system");
  })();
}
