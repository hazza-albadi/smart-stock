// Daily summary: one short card built ONLY from the database (alerts, recommendations, budget, space tables).
// Texts are stored as translatable messages {k, v} with the numbers as values; nothing is computed in the browser.
import { db } from "./db";
import { getSim, M, type Msg } from "./core";
import { loadSettings } from "./settings";
import { budgetInfo } from "./budget";

export interface SummaryRisk { key: string; item_id: string | null; severity: string; title: Msg }
export interface SummaryData {
  tick: number; date: string; trigger: string;
  risks: { total: number; top: SummaryRisk[] };
  decisions: { pending: number; oldest_age_h: number };
  budget: { granted: number; used: number; free: number };
  space: { listable_m2: number; leased_m2: number; income: number; offers_waiting: number };
  lines: { risks: Msg; decisions: Msg; budget: Msg; space: Msg; offers: Msg };
}

const one = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).get(...a) as T;

export function buildSummary(trigger: string): SummaryData {
  const cfg = loadSettings();
  const sim = getSim();
  const top = (db().prepare(`SELECT key, item_id, severity, title FROM alerts WHERE active=1 AND severity IN ('Critical','High')
      ORDER BY CASE severity WHEN 'Critical' THEN 0 ELSE 1 END, first_tick DESC, id LIMIT ?`).all(cfg.n("summary.top_risks")) as { key: string; item_id: string | null; severity: string; title: string }[])
    .map((r) => ({ key: r.key, item_id: r.item_id, severity: r.severity, title: JSON.parse(r.title) as Msg }));
  const riskTotal = one(`SELECT COUNT(*) n FROM alerts WHERE active=1 AND severity IN ('Critical','High')`).n as number;
  const pend = one(`SELECT COUNT(*) n, MIN(created_tick) t FROM recommendations WHERE status='PENDING'`) as { n: number; t: number | null };
  const oldest = pend.t === null ? 0 : sim.tick - pend.t;
  const bud = budgetInfo();
  const listable = (db().prepare(`SELECT COALESCE(SUM(m),0) a FROM (SELECT MAX(area) m FROM space_forecasts WHERE state='NEW' GROUP BY zone_id)`).get() as { a: number }).a;
  const leased = one(`SELECT COALESCE(SUM(area),0) a FROM space_leases WHERE status IN ('RESERVED','ACTIVE')`).a as number;
  const income = one(`SELECT COALESCE(SUM(income),0) a FROM space_leases`).a as number;
  const offers = one(`SELECT COUNT(*) n FROM space_offers WHERE status='PENDING'`).n as number;
  return {
    tick: sim.tick, date: sim.sim_date, trigger,
    risks: { total: riskTotal, top },
    decisions: { pending: pend.n, oldest_age_h: oldest },
    budget: { granted: bud.granted, used: bud.committed, free: bud.free },
    space: { listable_m2: listable, leased_m2: leased, income, offers_waiting: offers },
    lines: {
      risks: M(riskTotal ? "sum.risks" : "sum.risks_none", { n: riskTotal }),
      decisions: M(pend.n ? "sum.decisions" : "sum.decisions_none", { n: pend.n, age: oldest }),
      budget: M("sum.budget", { used: bud.committed, free: bud.free, total: bud.granted }),
      space: M("sum.space", { listable: listable, leased, income }),
      offers: M(offers ? "sum.offers" : "sum.offers_none", { n: offers }),
    },
  };
}

/** Stores the summary of the moment (after the 08:00 run, after "Run analysis", and at the start). */
export function writeSummary(trigger: string): SummaryData {
  const s = buildSummary(trigger);
  db().prepare(`INSERT INTO daily_summary(tick,sim_date,trigger,data) VALUES(?,?,?,?)`).run(s.tick, s.date, trigger, JSON.stringify(s));
  db().prepare(`DELETE FROM daily_summary WHERE id <= (SELECT MAX(id) FROM daily_summary) - ?`).run(loadSettings().n("summary.keep"));
  return s;
}

export function latestSummary(): SummaryData | null {
  const r = db().prepare(`SELECT data FROM daily_summary ORDER BY id DESC LIMIT 1`).get() as { data: string } | undefined;
  return r ? (JSON.parse(r.data) as SummaryData) : null;
}
