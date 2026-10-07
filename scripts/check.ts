// Prints the acceptance checks from the brief against the freshly seeded database.
// Usage: npm run test:agents [days]   (days = simulated days to advance before printing)
import { seedDatabase } from "../lib/seed";
import { db } from "../lib/db";
import { runAll } from "../lib/agents/coordinator";
import { tick } from "../lib/sim";
import { budgetInfo } from "../lib/agents/replenishment";

async function main() {
  const days = Number(process.argv[2] ?? 0);
  seedDatabase();
  await runAll({ useLlm: false, group: "start" });
  for (let i = 0; i < days; i++) await tick();
  const d = db();
  const all = (sql: string, ...a: unknown[]) => d.prepare(sql).all(...a) as Record<string, any>[];

  console.log("\n== sim", all(`SELECT sim_date, processed_through FROM sim_state`)[0]);
  console.log("\n== forecasts (interesting)");
  console.table(all(`SELECT item_id, round(weekly_usage,1) w, on_hand, round(weeks_cover,1) cover, round(anomaly_ratio,2) ratio, anomaly,
    round(season_factor,2) season, round(usable_qty) usable, stockout_date, days_to_stockout dts FROM forecasts
    WHERE item_id IN ('SKU-001','SKU-002','SKU-003','SKU-005','SKU-019','SKU-021','SKU-022','SKU-023')`));
  const b = budgetInfo();
  console.log("\n== budget", { total: b.total, committed: Math.round(b.committed), free: Math.round(b.total - b.committed) });
  console.log("\n== replenishment plan");
  console.table(all(`SELECT rank, item_id, qty, round(cost) cost, status, substr(reason_en,1,90) reason FROM replenishment_plan ORDER BY rank`));
  console.log("\n== zones");
  console.table(all(`SELECT zone_id, round(used) used, reserved, round(free) free, round(rentable) rentable, allocated, round(over_capacity) over FROM zone_space`));
  console.log("\n== alerts");
  console.table(all(`SELECT severity, kind, item_id, substr(title_en,1,80) title FROM alerts WHERE active=1 ORDER BY CASE severity WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Monitor' THEN 2 ELSE 3 END`));
  console.log("\n== recommendations");
  console.table(all(`SELECT id, key, kind, status FROM recommendations`));
  console.log("\n== space proposals");
  for (const r of all(`SELECT payload FROM recommendations WHERE kind='SPACE'`)) {
    const p = JSON.parse(r.payload);
    console.log(p.request_id, p.decision, p.area_m2, JSON.stringify(p.allocations), "|", p.reason_en);
  }
  console.log("\n== agent log (last run)");
  console.table(all(`SELECT agent, substr(summary_en,1,150) s FROM agent_runs ORDER BY id DESC LIMIT 5`));
  console.log("\n== events (latest 12)");
  console.table(all(`SELECT sim_date, type, severity, substr(message_en,1,90) m FROM events ORDER BY id DESC LIMIT 12`));
}
main();
