import Database from "better-sqlite3";
import path from "node:path";

let dbFile = process.env.SMARTSTOCK_DB || path.join(process.cwd(), "smartstock.db");

const g = globalThis as unknown as { __ssdb?: Database.Database; __ssfile?: string };

export function db(): Database.Database {
  if (g.__ssdb && g.__ssfile !== dbFile) { g.__ssdb.close(); g.__ssdb = undefined; }
  if (!g.__ssdb) {
    const d = new Database(dbFile);
    d.pragma("journal_mode = WAL");
    d.pragma("synchronous = NORMAL");
    g.__ssdb = d;
    g.__ssfile = dbFile;
  }
  return g.__ssdb;
}

export function closeDb() { if (g.__ssdb) { g.__ssdb.close(); g.__ssdb = undefined; } }

/** Point the app at another database file (used by the audit so it never touches the live DB). */
export function useDatabase(file: string) { dbFile = file; }

const TABLES = ["items", "suppliers", "stock_movements", "current_stock", "stock_opening", "purchase_orders_open", "purchasing_budget",
  "warehouse_zones", "space_requests", "agent_runs", "events", "recommendations", "decisions", "sim_state", "sim_baseline", "forecasts",
  "replenishment_plan", "zone_space", "alerts", "settings", "leases", "demand_log", "audit_results"];

export const SCHEMA = TABLES.map((t) => `DROP TABLE IF EXISTS ${t};`).join(" ") + `
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, unit TEXT, description TEXT);
CREATE TABLE items(item_id TEXT PRIMARY KEY, name_en TEXT, name_ar TEXT, category TEXT, storage_type TEXT, zone_id TEXT,
  unit TEXT, unit_cost_omr REAL, supplier_id TEXT, lead_time_days INTEGER, safety_stock REAL, shelf_life_days INTEGER,
  space_m2_per_unit REAL, criticality TEXT);
CREATE TABLE suppliers(supplier_id TEXT PRIMARY KEY, supplier_name TEXT, city TEXT, typical_lead_time_days INTEGER);
CREATE TABLE stock_movements(seq INTEGER PRIMARY KEY AUTOINCREMENT, movement_id TEXT, date TEXT, item_id TEXT,
  movement_type TEXT, quantity REAL, reference TEXT, balance_after REAL, sim INTEGER DEFAULT 0, tick INTEGER, lot_id TEXT, actor TEXT);
CREATE INDEX idx_mv_item_date ON stock_movements(item_id, date);
CREATE INDEX idx_mv_sim ON stock_movements(sim, tick);
CREATE TABLE current_stock(lot_id TEXT PRIMARY KEY, item_id TEXT, zone_id TEXT, quantity_on_hand REAL,
  received_date TEXT, expiry_date TEXT);
CREATE TABLE stock_opening(lot_id TEXT PRIMARY KEY, item_id TEXT, qty REAL);
CREATE TABLE purchase_orders_open(po_id TEXT PRIMARY KEY, item_id TEXT, supplier_id TEXT, quantity REAL, order_date TEXT,
  expected_arrival TEXT, status TEXT, source TEXT DEFAULT 'DATA', received_date TEXT, expected_hour INTEGER DEFAULT 0,
  ordered_tick INTEGER, received_tick INTEGER, emergency INTEGER DEFAULT 0, premium REAL DEFAULT 0, rec_key TEXT);
CREATE TABLE purchasing_budget(period_start TEXT, period_end TEXT, total_purchasing_budget_omr REAL, notes TEXT);
CREATE TABLE warehouse_zones(warehouse_id TEXT, zone_id TEXT PRIMARY KEY, zone_name TEXT, storage_type TEXT, capacity_m2 REAL,
  fixed_occupied_m2_aisles_equipment REAL, reserved_buffer_m2 REAL, rent_allowed TEXT, notes TEXT);
CREATE TABLE space_requests(request_id TEXT PRIMARY KEY, company TEXT, required_storage_type TEXT, area_needed_m2 REAL,
  duration_months INTEGER, needed_from TEXT, notes TEXT, source TEXT DEFAULT 'DATA', created_tick INTEGER DEFAULT 0);

CREATE TABLE agent_runs(id INTEGER PRIMARY KEY AUTOINCREMENT, run_group TEXT, agent TEXT, tick INTEGER, sim_date TEXT,
  started_at TEXT, finished_at TEXT, summary TEXT, trigger TEXT);
CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER, ts TEXT, sim_date TEXT, type TEXT, item_id TEXT,
  severity TEXT, msg TEXT, ref TEXT, actor TEXT DEFAULT 'system', meta TEXT);
CREATE INDEX idx_ev_item ON events(item_id, tick);
CREATE TABLE recommendations(id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE, kind TEXT, item_id TEXT, request_id TEXT,
  payload TEXT, status TEXT DEFAULT 'PENDING', created_tick INTEGER, decided_tick INTEGER, source TEXT DEFAULT 'agent', reopen_count INTEGER DEFAULT 0);
CREATE TABLE decisions(id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER, ts TEXT, rec_id INTEGER, rec_key TEXT, kind TEXT, item_id TEXT,
  request_id TEXT, decision TEXT, actor TEXT DEFAULT 'user', ref TEXT, detail TEXT);
CREATE TABLE sim_state(id INTEGER PRIMARY KEY CHECK (id = 1), tick INTEGER, sim_date TEXT, start_date TEXT, history_end TEXT,
  data_end TEXT, running INTEGER, interval_ms INTEGER, last_tick_at INTEGER DEFAULT 0);
CREATE TABLE sim_baseline(item_id TEXT PRIMARY KEY, daily_base REAL);

CREATE TABLE forecasts(item_id TEXT PRIMARY KEY, weekly_usage REAL, base_weekly REAL, prior12_avg REAL, last3_avg REAL, anomaly INTEGER,
  anomaly_ratio REAL, season_factor REAL, forecast_weeks TEXT, forecast_4w REAL, daily_forecast REAL, updated_tick INTEGER);
CREATE TABLE replenishment_plan(id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT, rank INTEGER, qty REAL, min_qty REAL,
  cost REAL, status TEXT, reason TEXT, rop REAL, position REAL, updated_tick INTEGER);
CREATE TABLE zone_space(zone_id TEXT PRIMARY KEY, capacity REAL, fixed REAL, stock_used REAL, used REAL, reserved REAL,
  rent_allowed INTEGER, free REAL, rentable REAL, allocated REAL, over_capacity REAL, updated_tick INTEGER);
CREATE TABLE alerts(id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE, kind TEXT, item_id TEXT, severity TEXT,
  title TEXT, detail TEXT, ignore_msg TEXT, rec_key TEXT, active INTEGER DEFAULT 1, first_tick INTEGER, updated_tick INTEGER);
CREATE TABLE leases(id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT, company TEXT, zone_id TEXT, area REAL, start_date TEXT,
  end_date TEXT, status TEXT, decided_tick INTEGER, ended_tick INTEGER);
CREATE TABLE demand_log(day INTEGER, item_id TEXT, hour INTEGER, planned REAL, issued REAL DEFAULT 0, PRIMARY KEY(day, item_id, hour));
CREATE TABLE audit_results(id INTEGER PRIMARY KEY AUTOINCREMENT, tick INTEGER, ts TEXT, kind TEXT, passed INTEGER, total INTEGER, failures TEXT);
`;
