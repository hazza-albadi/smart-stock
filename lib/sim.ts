import { db } from "./db";
import { addDays } from "./time";
import { rand } from "./rng";
import { clockAt } from "./clock";
import { dailyQuantity, hourlySplit, demandMultiplier, type SeasonCfg, type EventCfg } from "./calc";
import { getItems, getSim, logEvent, M, type Item, type Lot, type Po } from "./core";
import { loadSettings, setSetting, type Settings } from "./settings";
import { addMovement, issueFefo, receiveGoods, totalOnHand } from "./stock";
import { runAll, runScheduled } from "./agents/coordinator";
import { seedDatabase } from "./seed";
import { spaceHour } from "./space/market";

/** Plans the demand of one day: daily quantity per item (seeded), then split over 24 hours. Stored in demand_log. */
function ensureDemandPlan(cfg: Settings, day: number, date: string, items: Item[]) {
  const d = db();
  if ((d.prepare(`SELECT COUNT(*) c FROM demand_log WHERE day=?`).get(day) as { c: number }).c > 0) return;
  const seed = cfg.n("sim.seed");
  const season = cfg.j<SeasonCfg>("demand.season"), events = cfg.j<EventCfg[]>("demand.events");
  const profile = cfg.j<number[]>("demand.hourly_profile");
  const base = new Map((d.prepare(`SELECT item_id, daily_base FROM sim_baseline`).all() as { item_id: string; daily_base: number }[]).map((b) => [b.item_id, b.daily_base]));
  const ins = d.prepare(`INSERT INTO demand_log(day,item_id,hour,planned,issued) VALUES(?,?,?,?,0)`);
  for (const it of items) {
    const q = dailyQuantity({ base: base.get(it.item_id) ?? 0, mult: demandMultiplier(season, events, it.item_id, date), noise: cfg.n("demand.noise"), seed, date, item: it.item_id });
    if (q <= 0) continue;
    hourlySplit(q, profile, (i) => rand(`${seed}|${date}|${it.item_id}|h${i}`)).forEach((v, h) => { if (v > 0) ins.run(day, it.item_id, h, v); });
  }
}

function processHour(cfg: Settings, tick: number, items: Item[]) {
  const d = db();
  const s = getSim();
  const { date, hour, day } = clockAt(s.start_date, tick);
  const itemOf = new Map(items.map((i) => [i.item_id, i]));
  const lastUsable = cfg.n("expiry.last_usable_hour");

  spaceHour(cfg, tick); // leases start / end, rent accrues, offers expire / arrive, counter-offers are answered

  // 1) Lots past their expiry hour are written off (everything left in the lot).
  const expired = d.prepare(`SELECT * FROM current_stock WHERE expiry_date IS NOT NULL AND quantity_on_hand>0 AND (expiry_date<? OR (expiry_date=? AND ?>?))`)
    .all(date, date, hour, lastUsable) as Lot[];
  for (const l of expired) {
    const it = itemOf.get(l.item_id) as Item;
    d.prepare(`UPDATE current_stock SET quantity_on_hand=0 WHERE lot_id=?`).run(l.lot_id);
    addMovement(date, l.item_id, "OUT", l.quantity_on_hand, "EXPIRED", l.lot_id);
    logEvent("EXPIRED", l.item_id, M("ev.expired", { lot: l.lot_id, qty: l.quantity_on_hand, unit: it.unit, item: it.item_id, value: l.quantity_on_hand * it.unit_cost_omr }), "high", { ref: l.lot_id });
  }

  // 2) Purchase orders whose delivery date and hour have come are received (delayed POs only at their new date and hour).
  const due = d.prepare(`SELECT * FROM purchase_orders_open WHERE status IN ('OPEN','DELAYED_BY_SUPPLIER') AND (expected_arrival<? OR (expected_arrival=? AND expected_hour<=?))
    ORDER BY expected_arrival, expected_hour, po_id`).all(date, date, hour) as Po[];
  const retry = cfg.n("delivery.retry_hours");
  for (const p of due) {
    const it = itemOf.get(p.item_id) as Item;
    const r = receiveGoods(cfg, it, p.quantity, date, p.po_id);
    const later = clockAt(s.start_date, tick + retry);
    if (r.got > 0) {
      if (r.rest > 0) {
        // partial receipt: the received part keeps its budget value, the remainder is a new row retried later
        d.prepare(`UPDATE purchase_orders_open SET status='RECEIVED', received_date=?, received_tick=?, quantity=? WHERE po_id=?`).run(date, tick, r.got, p.po_id);
        const root = p.po_id.replace(/-R\d+$/, "");
        const n = (d.prepare(`SELECT COUNT(*) c FROM purchase_orders_open WHERE po_id LIKE ?`).get(root + "-R%") as { c: number }).c + 1;
        d.prepare(`INSERT INTO purchase_orders_open(po_id,item_id,supplier_id,quantity,order_date,expected_arrival,status,source,received_date,expected_hour,ordered_tick,received_tick,emergency,premium,rec_key)
          VALUES(?,?,?,?,?,?,'OPEN',?,NULL,?,?,NULL,?,?,?)`).run(`${root}-R${n}`, p.item_id, p.supplier_id, r.rest, p.order_date, later.date, p.source, later.hour, p.ordered_tick, p.emergency, p.premium, p.rec_key);
      } else d.prepare(`UPDATE purchase_orders_open SET status='RECEIVED', received_date=?, received_tick=? WHERE po_id=?`).run(date, tick, p.po_id);
      logEvent("PO_ARRIVED", p.item_id, M("ev.po_arrived", { po: p.po_id, qty: r.got, unit: it.unit, item: it.item_id, hour }), "info", { ref: p.po_id });
      if (r.inOver) logEvent("PO_OVERFLOW", p.item_id, M("ev.po_overflow", { po: p.po_id, qty: r.inOver, zone: cfg.s("space.overflow_zone"), home: it.zone_id, item: it.item_id }), "high", { ref: p.po_id });
      if (r.rest) logEvent("PO_HELD", p.item_id, M("ev.po_held", { po: p.po_id, qty: r.rest, hours: retry, item: it.item_id }), "high", { ref: p.po_id });
    } else {
      d.prepare(`UPDATE purchase_orders_open SET expected_arrival=?, expected_hour=? WHERE po_id=?`).run(later.date, later.hour, p.po_id);
      if (!d.prepare(`SELECT 1 FROM events WHERE type='RECEIVING_BLOCKED' AND ref=?`).get(p.po_id))
        logEvent("RECEIVING_BLOCKED", p.item_id, M("ev.receiving_blocked", { po: p.po_id, item: it.item_id, zone: it.zone_id, hours: retry }), "high", { ref: p.po_id });
    }
  }

  // 3) Hourly demand from today's plan (FEFO issue, stock never below zero; unmet demand is recorded).
  ensureDemandPlan(cfg, day, date, items);
  for (const row of d.prepare(`SELECT item_id, planned FROM demand_log WHERE day=? AND hour=? ORDER BY item_id`).all(day, hour) as { item_id: string; planned: number }[]) {
    const it = itemOf.get(row.item_id) as Item;
    const before = totalOnHand(it.item_id);
    const issued = issueFefo(it, Math.min(row.planned, before), date, "SALES/ISSUE");
    d.prepare(`UPDATE demand_log SET issued=? WHERE day=? AND item_id=? AND hour=?`).run(issued, day, it.item_id, hour);
    if (issued < row.planned || (before > 0 && before - issued <= 0)) {
      // one stock-out event per episode (until the next receipt)
      const lastIn = (d.prepare(`SELECT MAX(tick) m FROM stock_movements WHERE item_id=? AND movement_type='IN' AND sim=1`).get(it.item_id) as { m: number | null }).m ?? -1;
      const already = d.prepare(`SELECT 1 FROM events WHERE type='STOCKOUT' AND item_id=? AND tick>=?`).get(it.item_id, lastIn);
      if (!already || before > 0) logEvent("STOCKOUT", it.item_id, M("ev.stockout", { item: it.item_id }), "critical", { ref: it.item_id, meta: { pause: true } });
    }
  }
}

export interface TickResult {
  ignored?: "stale" | "paused" | "too_soon"; tick: number; sim_date: string; hour: number;
  movements: unknown[]; events: unknown[]; critical: unknown[]; paused: boolean; ticks: number;
}

const maxId = (t: string, c = "id") => (db().prepare(`SELECT COALESCE(MAX(${c}),0) m FROM ${t}`).get() as { m: number }).m;

/**
 * Advances the clock by ONE simulated hour inside a single transaction. The browser only asks for ticks; `expected` makes a request
 * idempotent (a stale or duplicate request is ignored) and `auto` requests are also refused while paused or faster than the interval.
 */
export function tick(o: { expected?: number; auto?: boolean } = {}): TickResult {
  const d = db();
  const s = getSim();
  const base = { tick: s.tick, sim_date: s.sim_date, hour: s.hour, movements: [], events: [], critical: [], paused: !s.running, ticks: 0 };
  if (o.expected !== undefined && o.expected !== s.tick) return { ...base, ignored: "stale" };
  if (o.auto && !s.running) return { ...base, ignored: "paused" };
  if (o.auto && Date.now() - s.last_tick_at < s.interval_ms * 0.8) return { ...base, ignored: "too_soon" };

  const cfg = loadSettings();
  const items = getItems();
  const lastSeq = maxId("stock_movements", "seq"), lastEvent = maxId("events");
  d.transaction(() => {
    processHour(cfg, s.tick, items);
    const next = clockAt(s.start_date, s.tick + 1);
    d.prepare(`UPDATE sim_state SET tick=?, sim_date=?, last_tick_at=?, data_end=CASE WHEN ?=0 THEN ? ELSE data_end END WHERE id=1`)
      .run(next.tick, next.date, Date.now(), next.hour, addDays(next.date, -1));
    runScheduled();
    const keep = cfg.n("log.keep_agent_runs");
    d.prepare(`DELETE FROM agent_runs WHERE id <= (SELECT COALESCE(MAX(id),0) FROM agent_runs) - ?`).run(keep);
  })();

  const movements = d.prepare(`SELECT m.seq, m.movement_id, m.date, m.tick, m.item_id, i.unit, m.movement_type, m.quantity, m.reference, m.balance_after, m.lot_id, m.actor
    FROM stock_movements m JOIN items i ON i.item_id=m.item_id WHERE m.seq>? ORDER BY m.seq`).all(lastSeq);
  const events = (d.prepare(`SELECT * FROM events WHERE id>? ORDER BY id`).all(lastEvent) as { severity: string; msg: string; meta: string | null }[])
    .map((e) => ({ ...e, msg: JSON.parse(e.msg), meta: e.meta ? JSON.parse(e.meta) : null }));
  const critical = events.filter((e) => (e.meta as { pause?: boolean } | null)?.pause === true); // once per event: events are logged once
  let paused = false;
  if (critical.length && cfg.b("sim.auto_pause_critical")) { d.prepare(`UPDATE sim_state SET running=0 WHERE id=1`).run(); paused = true; }
  const n = getSim();
  return { tick: n.tick, sim_date: n.sim_date, hour: n.hour, movements, events, critical, paused: paused || !n.running, ticks: 1 };
}

/** Server-side loop for "run N hours", "jump to next day" and "jump to next critical event". */
export function advance(o: { hours?: number; untilDay?: boolean; untilCritical?: boolean }): TickResult {
  const cfg = loadSettings();
  const cap = cfg.n("sim.max_advance_hours");
  const s = getSim();
  let hours = o.untilDay ? 24 - s.hour : Math.max(1, Math.floor(o.hours ?? 1));
  if (o.untilCritical) hours = cap;
  hours = Math.min(hours, cap);
  const acc: TickResult = { tick: s.tick, sim_date: s.sim_date, hour: s.hour, movements: [], events: [], critical: [], paused: !s.running, ticks: 0 };
  for (let i = 0; i < hours; i++) {
    const r = tick();
    acc.movements.push(...r.movements); acc.events.push(...r.events); acc.critical.push(...r.critical);
    acc.tick = r.tick; acc.sim_date = r.sim_date; acc.hour = r.hour; acc.paused = r.paused; acc.ticks++;
    if (r.critical.length && (o.untilCritical || cfg.b("sim.auto_pause_critical"))) {
      db().prepare(`UPDATE sim_state SET running=0 WHERE id=1`).run(); acc.paused = true; break;
    }
  }
  if (acc.movements.length > 400) acc.movements = acc.movements.slice(-400);
  return acc;
}

export const setRunning = (running: boolean) => { db().prepare(`UPDATE sim_state SET running=? WHERE id=1`).run(running ? 1 : 0); };

/** Changing the speed never touches the clock state: it only changes the pause between ticks. */
export function setIntervalMs(ms: number) {
  const min = loadSettings().n("sim.min_interval_ms");
  const v = Math.max(min, Math.round(Number(ms) || 0));
  db().prepare(`UPDATE sim_state SET interval_ms=? WHERE id=1`).run(v);
  setSetting("sim.interval_ms", v);
}

/** Restores the starting state (re-seeds from the CSV files, keeps the user's settings) and runs the agents once. */
export function resetSim() {
  seedDatabase({ keepSettings: true });
  runAll({ group: "start", trigger: "start" });
}
