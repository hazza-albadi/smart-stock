// "What changed after your decision": the difference between the snapshot before and after a human decision, in plain messages.
// Pure (no database): the browser computes it from the two snapshots it already has, so nothing new is stored or calculated on the server.
import type { Snapshot } from "./snapshot";
import type { Msg } from "./render";

export interface ChangeSummary { agents: string[]; lines: Msg[] }

const EPS = 0.0005; // half a baisa: smaller differences are rounding, not a change

/** Agents that ran after the decision (newest runs not in the old snapshot, in registry order) and the numbers on screen that moved. */
export function diffSnapshots(before: Snapshot, after: Snapshot): ChangeSummary {
  const lastRun = before.runs.reduce((m, r) => Math.max(m, r.id as number), 0);
  const ran = new Set(after.runs.filter((r) => (r.id as number) > lastRun).map((r) => r.agent as string));
  const agents = after.agent_order.filter((a) => ran.has(a));

  const lines: Msg[] = [];
  const num = (k: string, from: number, to: number, eps = 0) => { if (Math.abs(to - from) > eps) lines.push({ k, v: { from, to } }); };
  const waiting = (s: Snapshot) => s.recs.filter((r) => r.status === "PENDING" && !r.snoozed).length;
  num("chg.budget", before.kpi.budget_remaining, after.kpi.budget_remaining, EPS);
  num("chg.waiting", waiting(before), waiting(after));
  num("chg.space_waiting", before.space.kpi.waiting, after.space.kpi.waiting);
  num("chg.risk", before.kpi.items_at_risk, after.kpi.items_at_risk);
  num("chg.orders", before.kpi.po_open, after.kpi.po_open);
  num("chg.listed", before.space.kpi.listed_m2, after.space.kpi.listed_m2, EPS);
  num("chg.leased", before.space.kpi.leased_m2, after.space.kpi.leased_m2, EPS);
  num("chg.income", before.space.kpi.income_per_day, after.space.kpi.income_per_day, EPS);

  // risks: the serious ones that appeared (at most two by name) and how many went away
  const serious = (s: Snapshot) => new Map(s.alerts.filter((a) => a.severity === "Critical" || a.severity === "High").map((a) => [a.key as string, a]));
  const was = serious(before), now = serious(after);
  const fresh = [...now].filter(([k]) => !was.has(k)).map(([, a]) => a);
  for (const a of fresh.slice(0, 2)) lines.push({ k: "chg.new_alert", v: { title: a.title } });
  if (fresh.length > 2) lines.push({ k: "chg.new_alerts_more", v: { n: fresh.length - 2 } });
  const cleared = [...was.keys()].filter((k) => !now.has(k)).length;
  if (cleared) lines.push({ k: "chg.cleared", v: { n: cleared } });

  if (!lines.length) lines.push({ k: "chg.none" });
  return { agents, lines };
}
