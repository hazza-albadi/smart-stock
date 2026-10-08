import { db } from "./db";
import { addDays, diffDays } from "./time";
import { getSim, logEvent, M } from "./core";
import { loadSettings } from "./settings";
import { poValue } from "./calc";

export interface Period { id: number; period_start: string; period_end: string; total_purchasing_budget_omr: number; rollover: number; topup: number; source: string }

const all = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).all(...a) as T[];
const one = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).get(...a) as T | undefined;

export const periods = () => all<Period>(`SELECT * FROM purchasing_budget ORDER BY period_start, id`);

/** The budget period of a date. Before the first period starts, the first one applies (the simulation starts a day earlier than the data's first period). */
export function periodAt(date: string, list: Period[] = periods()): Period {
  let cur = list[0];
  for (const p of list) if (p.period_start <= date) cur = p;
  return cur;
}

/**
 * Budgets renew automatically: when a period has ended, the next ones are created (same length, renewal amount, optional rollover of unspent money).
 * Root cause of the old behaviour: the data holds ONE period and nothing ever created the next, and spend was summed over every PO ever placed.
 */
export function ensureBudgetPeriods(date: string) {
  const cfg = loadSettings();
  const d = db();
  let list = periods();
  if (!list.length) return;
  const first = list[0];
  const len = cfg.n("budget.period_days");
  const base = cfg.n("budget.renewal_amount") > 0 ? cfg.n("budget.renewal_amount") : first.total_purchasing_budget_omr;
  const pct = cfg.n("budget.rollover_pct") / 100;
  let guard = 0;
  while (list[list.length - 1].period_end < date && guard++ < 400) {
    const prev = list[list.length - 1];
    const start = addDays(prev.period_end, 1);
    const unspent = Math.max(0, budgetFor(prev, list).free);
    const rollover = Math.round(unspent * pct * 1000) / 1000;
    d.prepare(`INSERT INTO purchasing_budget(period_start,period_end,total_purchasing_budget_omr,notes,rollover,topup,source) VALUES(?,?,?,?,?,0,'RENEWAL')`)
      .run(start, addDays(start, len - 1), base, "Renewed automatically", rollover);
    list = periods();
    logEvent("BUDGET_RENEWED", null, M("ev.budget_renewed", { start, end: addDays(start, len - 1), total: base, rollover }), "info", { ref: start });
  }
}

/** Value of the purchase orders that count against a period: the ones placed in it (data orders count against the first), plus unreceived ones carried over (setting). */
export function budgetFor(p: Period, list: Period[] = periods()) {
  const cfg = loadSettings();
  const carry = cfg.b("budget.carry_commitments");
  const pos = all<{ po_id: string; quantity: number; unit_cost: number; premium: number; order_date: string; source: string; status: string }>(
    `SELECT p.po_id, p.quantity, i.unit_cost_omr unit_cost, p.premium, p.order_date, p.source, p.status FROM purchase_orders_open p JOIN items i ON i.item_id=p.item_id`);
  const idx = list.findIndex((x) => x.id === p.id);
  let placed = 0, carried = 0;
  for (const o of pos) {
    const own = o.source === "DATA" ? list[0] : periodAt(o.order_date, list);
    const v = poValue({ quantity: o.quantity, unit_cost: o.unit_cost, premium: o.premium });
    if (own.id === p.id) placed += v;
    else if (carry && idx > 0 && list.findIndex((x) => x.id === own.id) < idx && (o.status === "OPEN" || o.status === "DELAYED_BY_SUPPLIER")) carried += v;
  }
  const total = p.total_purchasing_budget_omr + p.rollover + p.topup;
  const committed = placed + carried;
  return { total, base: p.total_purchasing_budget_omr, rollover: p.rollover, topup: p.topup, placed, carried, committed, free: total - committed, overBudget: total - committed < -1e-9 };
}

/** Everything the app shows about the current budget period (single source for agents, alerts, KPIs and the audit). */
export function budgetInfo() {
  const cfg = loadSettings();
  const sim = getSim();
  ensureBudgetPeriods(sim.sim_date);
  const list = periods();
  const p = periodAt(sim.sim_date, list);
  const f = budgetFor(p, list);
  const next = list.find((x) => x.period_start > p.period_end);
  const nextStart = next?.period_start ?? addDays(p.period_end, 1);
  const base = cfg.n("budget.renewal_amount") > 0 ? cfg.n("budget.renewal_amount") : list[0].total_purchasing_budget_omr;
  const limit = (f.base * cfg.n("budget.emergency_limit_pct")) / 100;
  return {
    id: p.id, start: p.period_start, end: p.period_end, ...f, granted: f.base + f.rollover,
    daysLeft: Math.max(0, diffDays(p.period_end, sim.sim_date) + 1), nextStart, nextAmount: next?.total_purchasing_budget_omr ?? base,
    renewalTick: Math.max(0, diffDays(nextStart, sim.start_date) * 24),
    emergencyUsed: p.topup, emergencyLimit: limit, emergencyRoom: Math.max(0, limit - p.topup),
    lowLimit: (f.base * cfg.n("budget.low_pct")) / 100,
  };
}

/** Approved emergency spend: money added to the current period on top of the budget (limited by `budget.emergency_limit_pct`). */
export function recordTopup(amount: number, o: { po: string; item: string; reason: string }) {
  const b = budgetInfo();
  const s = getSim();
  db().prepare(`UPDATE purchasing_budget SET topup=topup+? WHERE id=?`).run(amount, b.id);
  db().prepare(`INSERT INTO budget_topups(tick,ts,period_id,amount,po_id,item_id,reason) VALUES(?,?,?,?,?,?,?)`).run(s.tick, new Date().toISOString(), b.id, amount, o.po, o.item, o.reason);
}

export function removeTopup(poId: string) {
  const d = db();
  for (const t of all<{ id: number; period_id: number; amount: number }>(`SELECT * FROM budget_topups WHERE po_id=?`, poId)) {
    d.prepare(`UPDATE purchasing_budget SET topup=MAX(0, topup-?) WHERE id=?`).run(t.amount, t.period_id);
    d.prepare(`DELETE FROM budget_topups WHERE id=?`).run(t.id);
  }
}
void one;
