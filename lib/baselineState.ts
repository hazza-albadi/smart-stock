import { db } from "./db";

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const all = (sql: string) => db().prepare(sql).all() as Record<string, any>[];

/** Day-0 state of the database in a stable, comparable form (numbers only come from SQL). */
export function readDay0State() {
  const zones = all(`SELECT zone_id, capacity, fixed, stock_used, used, reserved, rent_allowed, free, rentable, allocated, over_capacity FROM zone_space ORDER BY zone_id`)
    .map((z) => Object.fromEntries(Object.entries(z).map(([k, v]) => [k, typeof v === "number" ? r6(v) : v])));
  const rentable_by_zone = Object.fromEntries(zones.filter((z) => z.rent_allowed).map((z) => [z.zone_id, r6(z.rentable - z.allocated)]));
  const budgetRow = all(`SELECT total_purchasing_budget_omr t FROM purchasing_budget LIMIT 1`)[0];
  const committed = all(`SELECT COALESCE(SUM(p.quantity*i.unit_cost_omr),0) c FROM purchase_orders_open p JOIN items i ON i.item_id=p.item_id`)[0].c;
  const forecasts = all(`SELECT f.item_id, f.weekly_usage, f.base_weekly, f.prior12_avg, f.last3_avg, f.anomaly, f.anomaly_ratio, f.season_factor,
      (SELECT COALESCE(SUM(quantity_on_hand),0) FROM current_stock c WHERE c.item_id=f.item_id) on_hand FROM forecasts f ORDER BY f.item_id`)
    .map((f) => ({ ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === "number" ? r6(v) : v])),
      weeks_cover: f.weekly_usage > 0 ? r6(f.on_hand / f.weekly_usage) : null }));
  const plan = all(`SELECT item_id, rank, qty, cost, status, rop, position FROM replenishment_plan ORDER BY rank, item_id`)
    .map((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === "number" ? r6(v) : v])));
  const alerts = all(`SELECT key, kind, item_id, severity FROM alerts WHERE active=1 ORDER BY key`);
  const space = all(`SELECT request_id, payload FROM recommendations WHERE kind='SPACE' ORDER BY request_id`).map((r) => {
    const p = JSON.parse(r.payload);
    return { request_id: r.request_id, decision: p.decision, area_m2: r6(p.area_m2), allocations: (p.allocations as any[]).map((a) => ({ zone_id: a.zone_id, area: r6(a.area) })) };
  });
  const recs = all(`SELECT kind, key, status FROM recommendations ORDER BY key`);
  return {
    sim: all(`SELECT sim_date FROM sim_state`)[0]?.sim_date ?? null,
    zones, rentable_by_zone, rentable_total: r6(Object.values(rentable_by_zone).reduce((a: number, b) => a + (b as number), 0)),
    budget: { total: budgetRow.t, committed: r6(committed), free: r6(budgetRow.t - committed) },
    forecasts, plan, alerts, space_proposals: space, recommendations: recs,
  };
}
