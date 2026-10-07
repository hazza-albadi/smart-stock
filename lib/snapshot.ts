import { db } from "./db";
import { diffDays } from "./time";
import { getSim, type ForecastRow, type Item, type Lot, type Po } from "./core";
import { budgetInfo } from "./agents/replenishment";
import { AGENT_ORDER } from "./agents/coordinator";
import { llmEnabled } from "./llm";

export interface Rec {
  id: number; key: string; kind: "PO" | "SUPPLIER_MSG" | "SPACE"; item_id: string | null; request_id: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED"; payload: any; created_sim_date: string; decided_sim_date: string | null;
}
export type Status = "Critical" | "Low" | "OK" | "Overstock" | "Expiring";

const all = <T = Record<string, unknown>>(sql: string, ...a: unknown[]) => db().prepare(sql).all(...a) as T[];

/** One JSON document with everything the dashboard shows. Every number comes from SQLite. */
export function snapshot() {
  const sim = getSim();
  const today = sim.sim_date;
  const items = all<Item>(`SELECT * FROM items ORDER BY item_id`);
  const fc = new Map(all<ForecastRow>(`SELECT * FROM forecasts`).map((f) => [f.item_id, f]));
  const lots = all<Lot>(`SELECT * FROM current_stock WHERE quantity_on_hand>0`);
  const pos = all<Po>(`SELECT * FROM purchase_orders_open WHERE status IN ('OPEN','DELAYED_BY_SUPPLIER') ORDER BY expected_arrival`);
  const alerts = all<Record<string, any>>(`SELECT * FROM alerts WHERE active=1
    ORDER BY CASE severity WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Monitor' THEN 2 ELSE 3 END, id`);
  const recs: Rec[] = all<Record<string, any>>(`SELECT * FROM recommendations ORDER BY id`).map((r) => ({ ...r, payload: JSON.parse(r.payload) }) as Rec);

  const rows = items.map((it) => {
    const f = fc.get(it.item_id);
    const myLots = lots.filter((l) => l.item_id === it.item_id);
    const myPos = pos.filter((p) => p.item_id === it.item_id);
    const onHand = myLots.reduce((a, l) => a + l.quantity_on_hand, 0);
    const cover = f?.weeks_cover ?? 999;
    const poSoon = myPos.some((p) => p.status === "OPEN" && diffDays(p.expected_arrival, today) <= 3);
    const soonestExpiry = myLots.map((l) => l.expiry_date).filter(Boolean).sort()[0] ?? null;
    const expiring = myLots.some((l) => l.expiry_date && diffDays(l.expiry_date, today) <= 14 && f && l.quantity_on_hand > f.daily_forecast * (diffDays(l.expiry_date, today) + 1));
    let status: Status = "OK";
    if (onHand <= 0 || (cover < 1 && !poSoon)) status = "Critical";
    else if (expiring) status = "Expiring";
    else if (cover < 2 || onHand < it.safety_stock) status = "Low";
    else if (cover > 20) status = "Overstock";
    const next = myPos[0];
    return {
      item_id: it.item_id, name_ar: it.name_ar, name_en: it.name_en, category: it.category, unit: it.unit, zone_id: it.zone_id,
      criticality: it.criticality, unit_cost: it.unit_cost_omr, safety_stock: it.safety_stock, lead_time_days: it.lead_time_days,
      on_hand: onHand, weekly_usage: f?.weekly_usage ?? 0, weeks_cover: cover, status, anomaly: !!f?.anomaly,
      anomaly_ratio: f?.anomaly_ratio ?? 0, season_factor: f?.season_factor ?? 1, stockout_date: f?.stockout_date ?? null,
      expiry: soonestExpiry,
      po: next ? { po_id: next.po_id, qty: next.quantity, eta: next.expected_arrival, delayed: next.status === "DELAYED_BY_SUPPLIER" } : null,
      po_count: myPos.length,
    };
  });

  const bud = budgetInfo();
  const plan = all<Record<string, any>>(`SELECT p.*, i.name_ar, i.name_en, i.unit, i.criticality FROM replenishment_plan p
    JOIN items i ON i.item_id=p.item_id ORDER BY p.rank, p.item_id`);
  const funded = recs.filter((r) => r.kind === "PO" && r.status === "PENDING").reduce((a, r) => a + r.payload.cost, 0);
  const zones = all<Record<string, any>>(`SELECT z.*, w.zone_name, w.storage_type, w.notes FROM zone_space z JOIN warehouse_zones w ON w.zone_id=z.zone_id ORDER BY z.zone_id`);
  const requests = all<Record<string, any>>(`SELECT * FROM space_requests ORDER BY request_id`);
  const runs = all<Record<string, any>>(`SELECT * FROM agent_runs ORDER BY id DESC LIMIT 40`);
  const events = all<Record<string, any>>(`SELECT * FROM events ORDER BY id DESC LIMIT 60`);

  const riskItems = new Set(alerts.filter((a) => (a.severity === "Critical" || a.severity === "High") && a.item_id).map((a) => a.item_id));
  const rentable = zones.reduce((s, z) => s + Math.max(0, z.rentable - z.allocated), 0);

  return {
    sim: { date: today, speed: sim.speed, running: !!sim.running, tick_seconds: sim.tick_seconds, data_end: sim.processed_through },
    kpi: {
      items_at_risk: riskItems.size,
      budget_remaining: bud.total - bud.committed,
      budget_after_drafts: bud.total - bud.committed - funded,
      rentable_m2: rentable,
      pending: recs.filter((r) => r.status === "PENDING").length,
    },
    items: rows, alerts, recs, plan,
    budget: { total: bud.total, committed: bud.committed, new_funded: funded, start: bud.start, end: bud.end },
    zones, requests, runs, events, agent_order: AGENT_ORDER, llm: llmEnabled(),
  };
}
export type Snapshot = ReturnType<typeof snapshot>;
