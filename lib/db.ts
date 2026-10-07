import Database from "better-sqlite3";
import path from "node:path";

const DB_FILE = path.join(process.cwd(), "smartstock.db");

const g = globalThis as unknown as { __ssdb?: Database.Database };

export function db(): Database.Database {
  if (!g.__ssdb) {
    const d = new Database(DB_FILE);
    d.pragma("journal_mode = WAL");
    d.pragma("synchronous = NORMAL");
    g.__ssdb = d;
  }
  return g.__ssdb;
}

export const SCHEMA = `
DROP TABLE IF EXISTS items; DROP TABLE IF EXISTS suppliers; DROP TABLE IF EXISTS stock_movements;
DROP TABLE IF EXISTS current_stock; DROP TABLE IF EXISTS purchase_orders_open; DROP TABLE IF EXISTS purchasing_budget;
DROP TABLE IF EXISTS warehouse_zones; DROP TABLE IF EXISTS space_requests; DROP TABLE IF EXISTS agent_runs;
DROP TABLE IF EXISTS events; DROP TABLE IF EXISTS recommendations; DROP TABLE IF EXISTS sim_state;
DROP TABLE IF EXISTS sim_baseline; DROP TABLE IF EXISTS forecasts; DROP TABLE IF EXISTS replenishment_plan;
DROP TABLE IF EXISTS zone_space; DROP TABLE IF EXISTS alerts;

CREATE TABLE items(item_id TEXT PRIMARY KEY, name_en TEXT, name_ar TEXT, category TEXT, storage_type TEXT, zone_id TEXT,
  unit TEXT, unit_cost_omr REAL, supplier_id TEXT, lead_time_days INTEGER, safety_stock REAL, shelf_life_days INTEGER,
  space_m2_per_unit REAL, criticality TEXT);
CREATE TABLE suppliers(supplier_id TEXT PRIMARY KEY, supplier_name TEXT, city TEXT, typical_lead_time_days INTEGER);
CREATE TABLE stock_movements(seq INTEGER PRIMARY KEY AUTOINCREMENT, movement_id TEXT, date TEXT, item_id TEXT,
  movement_type TEXT, quantity REAL, reference TEXT, balance_after REAL, sim INTEGER DEFAULT 0);
CREATE INDEX idx_mv_item_date ON stock_movements(item_id, date);
CREATE TABLE current_stock(lot_id TEXT PRIMARY KEY, item_id TEXT, zone_id TEXT, quantity_on_hand REAL,
  received_date TEXT, expiry_date TEXT);
CREATE TABLE purchase_orders_open(po_id TEXT PRIMARY KEY, item_id TEXT, supplier_id TEXT, quantity REAL, order_date TEXT,
  expected_arrival TEXT, status TEXT, source TEXT DEFAULT 'DATA', received_date TEXT);
CREATE TABLE purchasing_budget(period_start TEXT, period_end TEXT, total_purchasing_budget_omr REAL, notes TEXT);
CREATE TABLE warehouse_zones(warehouse_id TEXT, zone_id TEXT PRIMARY KEY, zone_name TEXT, storage_type TEXT, capacity_m2 REAL,
  fixed_occupied_m2_aisles_equipment REAL, reserved_buffer_m2 REAL, rent_allowed TEXT, notes TEXT);
CREATE TABLE space_requests(request_id TEXT PRIMARY KEY, company TEXT, required_storage_type TEXT, area_needed_m2 REAL,
  duration_months INTEGER, needed_from TEXT, notes TEXT);

CREATE TABLE agent_runs(id INTEGER PRIMARY KEY AUTOINCREMENT, run_group TEXT, agent TEXT, sim_date TEXT,
  started_at TEXT, finished_at TEXT, summary_en TEXT, summary_ar TEXT);
CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, sim_date TEXT, type TEXT, item_id TEXT,
  message_ar TEXT, message_en TEXT, severity TEXT);
CREATE TABLE recommendations(id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE, kind TEXT, item_id TEXT, request_id TEXT,
  payload TEXT, status TEXT DEFAULT 'PENDING', created_sim_date TEXT, decided_at TEXT, decided_sim_date TEXT);
CREATE TABLE sim_state(id INTEGER PRIMARY KEY CHECK (id = 1), sim_date TEXT, processed_through TEXT, speed INTEGER,
  running INTEGER, seed INTEGER, tick_seconds REAL);
CREATE TABLE sim_baseline(item_id TEXT PRIMARY KEY, daily_base REAL);

CREATE TABLE forecasts(item_id TEXT PRIMARY KEY, weekly_usage REAL, base_weekly REAL, prior12_avg REAL, last3_avg REAL, anomaly INTEGER,
  anomaly_ratio REAL, season_factor REAL, forecast_weeks TEXT, forecast_4w REAL, on_hand REAL, usable_qty REAL,
  weeks_cover REAL, daily_forecast REAL, stockout_date TEXT, days_to_stockout INTEGER, updated_sim_date TEXT);
CREATE TABLE replenishment_plan(id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT, rank INTEGER, qty REAL, min_qty REAL,
  cost REAL, status TEXT, reason_en TEXT, reason_ar TEXT, rop REAL, position REAL, updated_sim_date TEXT);
CREATE TABLE zone_space(zone_id TEXT PRIMARY KEY, capacity REAL, fixed REAL, stock_used REAL, used REAL, reserved REAL,
  rent_allowed INTEGER, free REAL, rentable REAL, allocated REAL, over_capacity REAL, updated_sim_date TEXT);
CREATE TABLE alerts(id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE, kind TEXT, item_id TEXT, severity TEXT,
  title_en TEXT, title_ar TEXT, detail_en TEXT, detail_ar TEXT, rec_key TEXT, active INTEGER DEFAULT 1,
  first_sim_date TEXT, updated_sim_date TEXT);
`;
