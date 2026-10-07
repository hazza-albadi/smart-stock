// npm run check [hours] — prints the acceptance picture of the day-0 state (and optionally after N simulated hours), rendered in English.
import { seedDatabase } from "../lib/seed";
import { runAll } from "../lib/agents/coordinator";
import { advance } from "../lib/sim";
import { snapshot } from "../lib/snapshot";
import { render } from "../lib/render";
import { setSetting } from "../lib/settings";

seedDatabase();
runAll({ group: "start", trigger: "start" });
const hours = Number(process.argv[2] ?? 0);
if (hours > 0) { setSetting("sim.auto_pause_critical", false); advance({ hours }); }
const s = snapshot();
const items = Object.fromEntries(s.items.map((i) => [i.item_id, i]));
const R = (m: any) => render("en", m, { items });

console.log(`\n== clock: day ${s.sim.day + 1}, ${s.sim.date} ${String(s.sim.hour).padStart(2, "0")}:00 (tick ${s.sim.tick})`);
console.log("== KPIs", JSON.stringify(s.kpi));
console.log("\n== items");
console.table(s.items.map((i) => ({ id: i.item_id, onHand: Math.round(i.on_hand), perWeek: +i.weekly_usage.toFixed(1), cover: +i.weeks_cover.toFixed(2), status: i.status, anomaly: i.anomaly ? +i.anomaly_ratio.toFixed(2) : "", stockoutH: i.stockout_hours === null ? "" : Math.round(i.stockout_hours) })));
console.log("== budget", { total: s.budget.total, committed: Math.round(s.budget.committed), free: Math.round(s.kpi.budget_remaining) });
console.log("\n== replenishment plan");
console.table(s.plan.map((p) => ({ rank: p.rank, item: p.item_id, qty: p.qty, cost: Math.round(p.cost), status: p.status, reason: R(p.reason).slice(0, 90) })));
console.log("== zones");
console.table(s.zones.map((z) => ({ zone: z.zone_id, used: Math.round(z.used), reserved: z.reserved, rentable: Math.round(z.net), allocated: z.allocated, over: Math.round(z.over_capacity) })));
console.log("== space proposals");
for (const r of s.recs.filter((x) => x.kind === "SPACE")) console.log(`${r.request_id} ${r.payload.decision} ${Math.round(r.payload.area_m2)} | ${R(r.payload.reason)}${r.payload.note ? " | NOTE: " + R(r.payload.note) : ""}`);
console.log("\n== alerts");
console.table(s.alerts.map((a) => ({ severity: a.severity, kind: a.kind, title: R(a.title).slice(0, 80), ignore: a.ignore_msg ? R(a.ignore_msg).slice(0, 70) : "" })));
console.log("== pending recommendations:", s.recs.filter((r) => r.status === "PENDING").map((r) => r.key).join(", "));
