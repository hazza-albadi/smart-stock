import fs from "node:fs";
import path from "node:path";
import { db, SCHEMA } from "./db";
import { parseCsv } from "./csv";
import { START_DATE, HISTORY_END, addDays } from "./time";

const DATA_DIR = path.join(process.cwd(), "smartstock_data");
const read = (f: string) => parseCsv(fs.readFileSync(path.join(DATA_DIR, f), "utf8"));
const num = (v: string) => (v === "" ? null : Number(v));

/** Drops and recreates every table from the CSV files. Used by `npm run seed` and the Reset button. */
export function seedDatabase() {
  const d = db();
  d.exec(SCHEMA);

  const ins = (table: string, rows: Record<string, unknown>[]) => {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const st = d.prepare(`INSERT INTO ${table}(${cols.join(",")}) VALUES(${cols.map((c) => "@" + c).join(",")})`);
    for (const r of rows) st.run(r);
  };

  d.transaction(() => {
    ins("items", read("items.csv").map((r) => ({
      ...r, unit_cost_omr: +r.unit_cost_omr, lead_time_days: +r.lead_time_days, safety_stock: +r.safety_stock,
      shelf_life_days: num(r.shelf_life_days), space_m2_per_unit: +r.space_m2_per_unit,
    })));
    ins("suppliers", read("suppliers.csv").map((r) => ({ ...r, typical_lead_time_days: +r.typical_lead_time_days })));
    ins("stock_movements", read("stock_movements.csv").map((r) => ({
      movement_id: r.movement_id, date: r.date, item_id: r.item_id, movement_type: r.movement_type,
      quantity: +r.quantity, reference: r.reference, balance_after: null, sim: 0,
    })));
    ins("current_stock", read("current_stock.csv").map((r) => ({
      ...r, quantity_on_hand: +r.quantity_on_hand, expiry_date: r.expiry_date || null,
    })));
    ins("purchase_orders_open", read("purchase_orders_open.csv").map((r) => ({
      ...r, quantity: +r.quantity, source: "DATA", received_date: null,
    })));
    ins("purchasing_budget", read("purchasing_budget.csv").map((r) => ({
      ...r, total_purchasing_budget_omr: +r.total_purchasing_budget_omr,
    })));
    ins("warehouse_zones", read("warehouse_zones.csv").map((r) => ({
      ...r, capacity_m2: +r.capacity_m2, fixed_occupied_m2_aisles_equipment: +r.fixed_occupied_m2_aisles_equipment,
      reserved_buffer_m2: +r.reserved_buffer_m2,
    })));
    ins("space_requests", read("space_requests.csv").map((r) => ({
      ...r, area_needed_m2: +r.area_needed_m2, duration_months: +r.duration_months,
    })));

    // Baseline daily usage per item, taken once from the 4 weeks of history before the simulation starts
    // (SKU-019: the 12 weeks before its spike, so the simulator can replay the spike on its own schedule).
    const itemsRows = d.prepare(`SELECT item_id FROM items`).all() as { item_id: string }[];
    const sum = d.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM stock_movements WHERE item_id=? AND movement_type='OUT'
      AND reference!='EXPIRED' AND date BETWEEN ? AND ?`);
    const bi = d.prepare(`INSERT INTO sim_baseline VALUES(?,?)`);
    for (const { item_id } of itemsRows) {
      const [from, to, days] = item_id === "SKU-019"
        ? [addDays(HISTORY_END, -104), addDays(HISTORY_END, -21), 84]
        : [addDays(HISTORY_END, -27), HISTORY_END, 28];
      const q = (sum.get(item_id, from, to) as { q: number }).q;
      bi.run(item_id, q / days);
    }

    d.prepare(`INSERT INTO sim_state VALUES(1,?,?,?,?,?,?)`).run(START_DATE, HISTORY_END, 1, 0, 42, 3);
    d.prepare(`INSERT INTO events(ts,sim_date,type,item_id,message_ar,message_en,severity) VALUES(?,?,?,?,?,?,?)`).run(
      new Date().toISOString(), START_DATE, "SYSTEM", null,
      "المحاكاة جاهزة — تاريخ اليوم 2026-10-05", "Simulation ready — today is 2026-10-05", "info");
  })();
}
