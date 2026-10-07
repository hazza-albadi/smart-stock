import { seedDatabase } from "../lib/seed";
import { db } from "../lib/db";
import { runAll } from "../lib/agents/coordinator";

seedDatabase();
// Run the five agents once so the dashboard has content on first load.
runAll({ useLlm: false }).then(() => {
  const n = (t: string) => (db().prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
  console.log(
    `Seeded smartstock.db — items:${n("items")} movements:${n("stock_movements")} lots:${n("current_stock")} ` +
      `alerts:${n("alerts")} recommendations:${n("recommendations")}`,
  );
});
