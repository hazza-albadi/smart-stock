import { db } from "./db";

export interface Item {
  item_id: string; name_en: string; name_ar: string; category: string; storage_type: string; zone_id: string;
  unit: string; unit_cost_omr: number; supplier_id: string; lead_time_days: number; safety_stock: number;
  shelf_life_days: number | null; space_m2_per_unit: number; criticality: "A" | "B" | "C";
}
export interface SimState {
  sim_date: string; processed_through: string; speed: number; running: number; seed: number; tick_seconds: number;
}
export interface Po {
  po_id: string; item_id: string; supplier_id: string; quantity: number; order_date: string; expected_arrival: string;
  status: string; source: string; received_date: string | null;
}
export interface Lot { lot_id: string; item_id: string; zone_id: string; quantity_on_hand: number; received_date: string; expiry_date: string | null }
export interface ForecastRow {
  item_id: string; weekly_usage: number; base_weekly: number; prior12_avg: number; last3_avg: number; anomaly: number;
  anomaly_ratio: number; season_factor: number; forecast_weeks: string; forecast_4w: number; on_hand: number;
  usable_qty: number; weeks_cover: number; daily_forecast: number; stockout_date: string | null;
  days_to_stockout: number | null; updated_sim_date: string;
}
export type Severity = "Critical" | "High" | "Monitor" | "Info";

export const getSim = () => db().prepare(`SELECT * FROM sim_state WHERE id=1`).get() as SimState;
export const getItems = () => db().prepare(`SELECT * FROM items ORDER BY item_id`).all() as Item[];

export function logEvent(type: string, itemId: string | null, ar: string, en: string, severity: string) {
  db().prepare(`INSERT INTO events(ts,sim_date,type,item_id,message_ar,message_en,severity) VALUES(?,?,?,?,?,?,?)`)
    .run(new Date().toISOString(), getSim().sim_date, type, itemId, ar, en, severity);
}

export function logRun(group: string, agent: string, startedAt: string, en: string, ar: string) {
  db().prepare(`INSERT INTO agent_runs(run_group,agent,sim_date,started_at,finished_at,summary_en,summary_ar) VALUES(?,?,?,?,?,?,?)`)
    .run(group, agent, getSim().sim_date, startedAt, new Date().toISOString(), en, ar);
}

export interface AgentResult { en: string; ar: string }

/** Creates or refreshes a PENDING recommendation. Decided ones are left untouched. Returns the stored status. */
export function upsertRec(key: string, kind: string, itemId: string | null, requestId: string | null, payload: unknown): string {
  const d = db();
  const row = d.prepare(`SELECT status FROM recommendations WHERE key=?`).get(key) as { status: string } | undefined;
  const json = JSON.stringify(payload);
  if (!row) {
    d.prepare(`INSERT INTO recommendations(key,kind,item_id,request_id,payload,status,created_sim_date) VALUES(?,?,?,?,?,'PENDING',?)`)
      .run(key, kind, itemId, requestId, json, getSim().sim_date);
    return "PENDING";
  }
  if (row.status === "PENDING") d.prepare(`UPDATE recommendations SET payload=? WHERE key=?`).run(json, key);
  return row.status;
}

export const fmt = (n: number, dp = 0) =>
  n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

const UNIT_AR: Record<string, string> = {
  kg: "كجم", carboy: "جالون", bag: "كيس", bottle: "زجاجة", drum: "برميل", jerrycan: "غالون", box: "علبة", roll: "رول",
  piece: "قطعة", pack: "حزمة", bundle: "ربطة", set: "طقم", pallet: "طبلية",
};
export const uAr = (u: string) => UNIT_AR[u] ?? u;
