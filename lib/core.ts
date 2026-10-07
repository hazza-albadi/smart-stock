import { db } from "./db";
import { clockAt, type Clock } from "./clock";

export interface Msg { k: string; v?: Record<string, unknown> }
export const M = (k: string, v?: Record<string, unknown>): Msg => ({ k, v });

export interface Item {
  item_id: string; name_en: string; name_ar: string; category: string; storage_type: string; zone_id: string;
  unit: string; unit_cost_omr: number; supplier_id: string; lead_time_days: number; safety_stock: number;
  shelf_life_days: number | null; space_m2_per_unit: number; criticality: string;
}
export interface SimState extends Clock {
  sim_date: string; start_date: string; history_end: string; data_end: string; running: number; interval_ms: number; last_tick_at: number;
}
export interface Po {
  po_id: string; item_id: string; supplier_id: string; quantity: number; order_date: string; expected_arrival: string;
  expected_hour: number; status: string; source: string; received_date: string | null; ordered_tick: number | null;
  received_tick: number | null; emergency: number; premium: number; rec_key: string | null;
}
export interface Lot { lot_id: string; item_id: string; zone_id: string; quantity_on_hand: number; received_date: string; expiry_date: string | null }
export interface ForecastRow {
  item_id: string; weekly_usage: number; base_weekly: number; prior12_avg: number; last3_avg: number; anomaly: number;
  anomaly_ratio: number; season_factor: number; forecast_weeks: string; forecast_4w: number; daily_forecast: number; updated_tick: number;
}
export type Severity = "Critical" | "High" | "Monitor" | "Info";
export interface AgentResult { msg: Msg }

export function getSim(): SimState {
  const s = db().prepare(`SELECT * FROM sim_state WHERE id=1`).get() as {
    tick: number; start_date: string; history_end: string; data_end: string; running: number; interval_ms: number; last_tick_at: number;
  };
  return { ...s, ...clockAt(s.start_date, s.tick), sim_date: clockAt(s.start_date, s.tick).date };
}
export const getItems = () => db().prepare(`SELECT * FROM items ORDER BY item_id`).all() as Item[];

export function logEvent(type: string, itemId: string | null, msg: Msg, severity: string, o: { ref?: string; actor?: string; meta?: unknown } = {}) {
  const s = getSim();
  db().prepare(`INSERT INTO events(tick,ts,sim_date,type,item_id,severity,msg,ref,actor,meta) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .run(s.tick, new Date().toISOString(), s.sim_date, type, itemId, severity, JSON.stringify(msg), o.ref ?? null, o.actor ?? "system",
      o.meta === undefined ? null : JSON.stringify(o.meta));
}

export function logRun(group: string, agent: string, trigger: string, startedAt: string, msg: Msg) {
  const s = getSim();
  db().prepare(`INSERT INTO agent_runs(run_group,agent,tick,sim_date,started_at,finished_at,summary,trigger) VALUES(?,?,?,?,?,?,?,?)`)
    .run(group, agent, s.tick, s.sim_date, startedAt, new Date().toISOString(), JSON.stringify(msg), trigger);
}

/** Creates or refreshes a PENDING recommendation (stable dedupe key). Decided ones are left untouched; returns the stored status. */
export function upsertRec(key: string, kind: string, itemId: string | null, requestId: string | null, payload: unknown, source = "agent"): string {
  const d = db();
  const row = d.prepare(`SELECT status FROM recommendations WHERE key=?`).get(key) as { status: string } | undefined;
  const json = JSON.stringify(payload);
  if (!row) {
    d.prepare(`INSERT INTO recommendations(key,kind,item_id,request_id,payload,status,created_tick,source) VALUES(?,?,?,?,?,'PENDING',?,?)`)
      .run(key, kind, itemId, requestId, json, getSim().tick, source);
    return "PENDING";
  }
  if (row.status === "PENDING") {
    // a postponement chosen by the user survives the hourly refresh
    const old = JSON.parse((d.prepare(`SELECT payload FROM recommendations WHERE key=?`).get(key) as { payload: string }).payload);
    const merged = old.snooze_until ? { ...(payload as object), snooze_until: old.snooze_until } : payload;
    d.prepare(`UPDATE recommendations SET payload=? WHERE key=?`).run(JSON.stringify(merged), key);
  }
  return row.status;
}

/** Brings a decided recommendation back to PENDING (cooldown over or situation materially worse). */
export function reopenRec(key: string, payload: unknown) {
  db().prepare(`UPDATE recommendations SET status='PENDING', payload=?, created_tick=?, decided_tick=NULL, reopen_count=reopen_count+1 WHERE key=?`)
    .run(JSON.stringify(payload), getSim().tick, key);
}

export function recPayload<T = any>(key: string): { status: string; payload: T; decided_tick: number | null } | null {
  const r = db().prepare(`SELECT status, payload, decided_tick FROM recommendations WHERE key=?`).get(key) as { status: string; payload: string; decided_tick: number | null } | undefined;
  return r ? { status: r.status, payload: JSON.parse(r.payload), decided_tick: r.decided_tick } : null;
}
