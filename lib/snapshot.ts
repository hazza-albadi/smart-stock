import { db } from "./db";
import { diffDays } from "./time";
import { getSim, type Lot } from "./core";
import { loadSettings } from "./settings";
import { loadLive } from "./live";
import { statusOf, ex, demandOver, coverHours, type Explain, type Status } from "./calc";
import { budgetInfo } from "./agents/replenishment";
import { AGENT_ORDER } from "./agents/coordinator";
import { computeZones } from "./zones";
import { spaceSnapshot } from "./space/snapshot";
import { llmEnabled } from "./llm";

export type { Status };
export interface Rec {
  snoozed: boolean;
  id: number; key: string; kind: "PO" | "SUPPLIER_MSG"; item_id: string | null; request_id: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED"; payload: any; created_tick: number; decided_tick: number | null; source: string;
  reopen_count: number; age_hours: number; overdue: boolean;
}

const all = (sql: string, ...a: unknown[]): any[] => db().prepare(sql).all(...a);

/** One JSON document with everything the dashboard shows. Every business number comes from SQLite through lib/calc; the UI only formats it. */
const g = globalThis as unknown as { __sssseq?: number };

export function snapshot() {
  g.__sssseq = (g.__sssseq ?? 0) + 1; // monotonic: the browser ignores a snapshot older than the one it shows
  const cfg = loadSettings();
  const sim = getSim();
  const now = { date: sim.sim_date, hour: sim.hour };
  const live = loadLive(cfg, now);
  const alerts: Record<string, any>[] = all(`SELECT * FROM alerts WHERE active=1 ORDER BY CASE severity WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Monitor' THEN 2 ELSE 3 END, first_tick DESC, id`)
    .map((a): Record<string, any> => ({ ...a, title: JSON.parse(a.title), detail: JSON.parse(a.detail), ignore_msg: a.ignore_msg ? JSON.parse(a.ignore_msg) : null, since_tick: a.first_tick }));
  const escalate = cfg.n("rec.escalate_hours");
  const recs: Rec[] = all(`SELECT * FROM recommendations ORDER BY id`).map((r) => ({
    ...r, payload: JSON.parse(r.payload), age_hours: sim.tick - r.created_tick, snoozed: (JSON.parse(r.payload).snooze_until ?? 0) > sim.tick, overdue: r.status === "PENDING" && sim.tick - r.created_tick >= escalate && !((JSON.parse(r.payload).snooze_until ?? 0) > sim.tick),
  }) as Rec);

  const st = { criticalCover: cfg.n("status.critical_cover_weeks"), poSoonDays: cfg.n("status.po_soon_days"), lowCover: cfg.n("status.low_cover_weeks"), overstock: cfg.n("thresholds.overstock_weeks") };
  const expiryDays = cfg.n("thresholds.expiry_days"), lastUsable = cfg.n("expiry.last_usable_hour");
  const classes = [...new Set([...live.values()].map((l) => l.item.criticality))].sort();
  const items = [...live.values()].map((l) => {
    const it = l.item;
    const f = l.fc;
    const poSoon = l.pos.some((p) => p.status === "OPEN" && diffDays(p.expected_arrival, now.date) <= st.poSoonDays);
    const lots = l.lots as Lot[];
    const expiry = lots.map((x) => x.expiry_date).filter(Boolean).sort()[0] ?? null;
    const expiring = !!f && lots.some((x) => {
      if (!x.expiry_date) return false;
      const days = diffDays(x.expiry_date, now.date);
      const hoursLeft = days * 24 + lastUsable + 1 - now.hour;
      return days <= expiryDays && x.quantity_on_hand > (f.daily_forecast * hoursLeft) / 24;
    });
    const status = statusOf({ onHand: l.onHand, cover: l.cover, safety: it.safety_stock, poSoon, expiring }, st);
    const next = l.pos[0];
    const explain: Record<string, Explain> = {
      cover: ex("ex.cover", [
        { label: "ex.in.onhand", value: l.onHand, unit: it.unit, source: "current_stock" },
        { label: "ex.in.weekly", value: l.weeklyUsage, unit: it.unit, source: "stock_movements" },
      ], l.cover, "wk"),
      status: ex("ex.status", [
        { label: "ex.in.cover", value: l.cover, unit: "wk", source: "calc" },
        { label: "ex.in.safety", value: it.safety_stock, unit: it.unit, source: "items" },
        { label: "ex.in.thresholds", value: `${st.criticalCover} / ${st.lowCover} / ${st.overstock}`, unit: "wk", source: "settings" },
      ], status),
    };
    return {
      item_id: it.item_id, name_ar: it.name_ar, name_en: it.name_en, category: it.category, unit: it.unit, zone_id: it.zone_id,
      criticality: it.criticality, crit_rank: classes.indexOf(it.criticality), unit_cost: it.unit_cost_omr, safety_stock: it.safety_stock, lead_time_days: it.lead_time_days,
      on_hand: l.onHand, usable: l.usable, lasts_hours: l.onHand <= 0 ? 0 : coverHours(l.onHand, l.weeklyUsage), weekly_usage: l.weeklyUsage, weeks_cover: l.cover, status, anomaly: !!f?.anomaly,
      anomaly_ratio: f?.anomaly_ratio ?? 0, season_factor: f?.season_factor ?? 1, stockout_date: l.stockout?.date ?? null,
      stockout_hours: l.onHand <= 0 ? 0 : l.stockout?.hours ?? null, expiry,
      po: next ? { po_id: next.po_id, qty: next.quantity, eta: next.expected_arrival, hour: next.expected_hour, delayed: next.status === "DELAYED_BY_SUPPLIER" } : null,
      po_count: l.pos.length, explain,
    };
  });

  const bud = budgetInfo();
  const pendingPo = recs.filter((r) => r.kind === "PO" && r.status === "PENDING" && r.source === "agent").reduce((a, r) => a + r.payload.cost, 0);
  const plan = all(`SELECT p.*, i.name_ar, i.name_en, i.unit, i.criticality FROM replenishment_plan p JOIN items i ON i.item_id=p.item_id ORDER BY p.rank, p.item_id`)
    .map((p) => ({ ...p, reason: JSON.parse(p.reason),
      explain: p.status === "OVERSTOCK" ? null : ex("ex.rop", [
        { label: "ex.in.position", value: p.position, unit: p.unit, source: "current_stock + purchase_orders_open" },
        { label: "ex.in.rop", value: p.rop, unit: p.unit, source: "forecast + safety stock" },
      ], p.position <= p.rop ? "below" : "above") }));

  const zones = computeZones();
  const runs = all(`SELECT * FROM agent_runs ORDER BY id DESC LIMIT 120`).map((r) => ({ ...r, summary: JSON.parse(r.summary) }));
  const events = all(`SELECT * FROM events WHERE id IN (SELECT id FROM events WHERE flow IN ('purchasing','both') ORDER BY id DESC LIMIT ?) OR id IN (SELECT id FROM events WHERE flow IN ('space','both') ORDER BY id DESC LIMIT ?) ORDER BY id DESC`, cfg.n("ui.feed_page_size"), cfg.n("ui.feed_page_size")).map((e) => ({ ...e, msg: JSON.parse(e.msg), meta: e.meta ? JSON.parse(e.meta) : null }));
  const recent = all(`SELECT m.seq, m.date, m.tick, m.item_id, i.unit, m.movement_type, m.quantity, m.reference, m.balance_after, m.lot_id, m.actor
    FROM stock_movements m JOIN items i ON i.item_id=m.item_id WHERE m.sim=1 ORDER BY m.seq DESC LIMIT ?`, cfg.n("ui.feed_page_size"));
  const totals = all(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN movement_type='IN' THEN quantity END),0) qin, COALESCE(SUM(CASE WHEN movement_type='OUT' THEN quantity END),0) qout
    FROM stock_movements WHERE sim=1`)[0];
  const healthRow = all(`SELECT * FROM audit_results ORDER BY id DESC LIMIT 1`)[0];
  const health = healthRow ? { ...healthRow, by_flow: healthRow.by_flow ? JSON.parse(healthRow.by_flow) : null } : null;

  const riskItems = new Set(alerts.filter((a) => (a.severity === "Critical" || a.severity === "High") && a.item_id).map((a) => a.item_id));
  const rentable = zones.reduce((s, z) => s + z.net, 0);
  const pending = recs.filter((r) => r.status === "PENDING").length;

  const kpi = {
    items_at_risk: riskItems.size, budget_remaining: bud.free, budget_after_drafts: bud.free - pendingPo, over_budget: bud.overBudget,
    rentable_m2: rentable, po_open: (all(`SELECT COUNT(*) n FROM purchase_orders_open WHERE status IN ('OPEN','DELAYED_BY_SUPPLIER')`)[0]?.n as number) ?? 0, pending,
  };
  const kpiExplain: Record<string, Explain> = {
    risk: ex("ex.kpi.risk", [{ label: "ex.in.alerts_ch", value: alerts.filter((a) => a.severity === "Critical" || a.severity === "High").length, source: "alerts" }], riskItems.size),
    budget: ex("ex.kpi.budget", [
      { label: "ex.in.budget_total", value: bud.total, unit: "OMR", source: "purchasing_budget" },
      { label: "ex.in.committed", value: bud.committed, unit: "OMR", source: "purchase_orders_open × items.unit_cost" },
    ], bud.free, "OMR"),
    rentable: ex("ex.kpi.rentable", zones.filter((z) => z.rent_allowed).flatMap((z) => [
      { label: "ex.in.zone_formula", value: `${Math.round(z.capacity)} − ${Math.round(z.used)} − ${Math.round(z.reserved)} − ${Math.round(z.allocated)}`, unit: "m²", source: z.zone_id },
    ]), rentable, "m²"),
    orders: ex("ex.kpi.orders", [{ label: "ex.in.open_pos", value: (all(`SELECT COUNT(*) n FROM purchase_orders_open WHERE status IN ('OPEN','DELAYED_BY_SUPPLIER')`)[0]?.n as number) ?? 0, source: "purchase_orders_open" }], (all(`SELECT COUNT(*) n FROM purchase_orders_open WHERE status IN ('OPEN','DELAYED_BY_SUPPLIER')`)[0]?.n as number) ?? 0),
    pending: ex("ex.kpi.pending", [{ label: "ex.in.pending_recs", value: pending, source: "recommendations" }], pending),
  };

  return {
    sim: {
      tick: sim.tick, date: sim.sim_date, hour: sim.hour, day: sim.day, running: !!sim.running, interval_ms: sim.interval_ms, data_end: sim.data_end,
      auto_pause: cfg.b("sim.auto_pause_critical"), presets: cfg.j<number[]>("sim.interval_presets_ms"), min_interval_ms: cfg.n("sim.min_interval_ms"),
      max_advance: cfg.n("sim.max_advance_hours"), rentable_type: cfg.s("space.rentable_request_type"), start_date: sim.start_date, postpone_hours: cfg.n("rec.postpone_hours"), undo_seconds: cfg.n("ui.undo_seconds"), seq: g.__sssseq, decided: recs.filter((r) => r.status !== "PENDING").length + ((all(`SELECT COUNT(*) n FROM space_decisions`)[0]?.n as number) ?? 0), page_size: cfg.n("ui.feed_page_size"), utc_offset: cfg.n("sim.utc_offset_hours"),
    },
    names: Object.fromEntries(items.map((i) => [i.item_id, { name_en: i.name_en, name_ar: i.name_ar, unit: i.unit }])),
    kpi, kpi_explain: kpiExplain, items, alerts, recs, plan, space: spaceSnapshot(), runs, events, recent_movements: recent, totals, health,
    budget: { total: bud.total, committed: bud.committed, new_funded: pendingPo, start: bud.start, end: bud.end, over: bud.overBudget,
      explain: ex("ex.budget", [{ label: "ex.in.budget_total", value: bud.total, unit: "OMR" }, { label: "ex.in.committed", value: bud.committed, unit: "OMR" }, { label: "ex.in.drafts", value: pendingPo, unit: "OMR" }], bud.free - pendingPo, "OMR") },
    zones: zones.map((z) => ({ ...z, explain: ex("ex.zone", [
      { label: "ex.in.capacity", value: z.capacity, unit: "m²", source: "warehouse_zones" },
      { label: "ex.in.fixed", value: z.fixed, unit: "m²", source: "warehouse_zones" },
      { label: "ex.in.stock_area", value: z.stock_used, unit: "m²", source: "current_stock × items.space_m2_per_unit" },
      { label: "ex.in.buffer", value: z.reserved, unit: "m²", source: "warehouse_zones" },
      { label: "ex.in.leases_active", value: z.allocated, unit: "m²", source: "leases" },
    ], z.net, "m²") })),
    agent_order: AGENT_ORDER, llm: llmEnabled(),
  };
}
export type Snapshot = ReturnType<typeof snapshot>;
export { demandOver };
