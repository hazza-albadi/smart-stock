import { db } from "../db";
import { addDays } from "../time";
import { budgetFigures, reorderPoint, demandOver, poWithin, roundUpTo } from "../calc";
import { getSim, logRun, logEvent, upsertRec, reopenRec, recPayload, M, type AgentResult, type Item, type Msg } from "../core";
import { loadSettings } from "../settings";
import { loadLive, type Live } from "../live";
import { zoneRoomBase } from "../stock";
import { leasedOn } from "../zones";

export function budgetInfo() {
  const b = db().prepare(`SELECT * FROM purchasing_budget LIMIT 1`).get() as {
    period_start: string; period_end: string; total_purchasing_budget_omr: number;
  };
  const pos = db().prepare(`SELECT p.quantity, i.unit_cost_omr unit_cost, p.premium FROM purchase_orders_open p JOIN items i ON i.item_id=p.item_id`).all() as
    { quantity: number; unit_cost: number; premium: number }[];
  const f = budgetFigures(b.total_purchasing_budget_omr, pos);
  return { total: f.total, start: b.period_start, end: b.period_end, committed: f.committed, free: f.free, overBudget: f.overBudget };
}

/** Context stored with a recommendation, used later to tell whether a rejected draft got materially worse. */
export const recContext = (l: Live) => ({ cover: l.cover, stockout_hours: l.stockout?.hours ?? null });

/**
 * Room model shared by the replenishment agent and the approval check: physical room per zone on the day an order would arrive.
 * Signed leases are the only rental data it reads (through lib/zones.ts): leased area is unavailable from the lease start to its end.
 */
export function roomModel(cfg: ReturnType<typeof loadSettings>, live: Map<string, Live>, now: { date: string; hour: number }) {
  const d = db();
  const byZone = new Map<string, Live[]>();
  for (const l of live.values()) byZone.set(l.item.zone_id, [...(byZone.get(l.item.zone_id) ?? []), l]);
  const rentZones = new Set((d.prepare(`SELECT zone_id FROM warehouse_zones WHERE rent_allowed='yes'`).all() as { zone_id: string }[]).map((z) => z.zone_id));
  const overflow = cfg.s("space.overflow_zone");
  const promised = new Map<string, number>(); // m2 already promised to drafts of this run (higher priority first)
  const roomAt = (zone: string, days: number, withLeases = true) => {
    const arrival = addDays(now.date, days);
    let r = zoneRoomBase(zone);
    for (const x of byZone.get(zone) ?? []) {
      const sp = x.item.space_m2_per_unit;
      r += Math.min(x.onHand, demandOver(x.model, now, days * 24)) * sp; // stock used up before arrival frees room
      r -= poWithin(x.pos, now.date, days) * sp; // incoming POs take room
    }
    if (withLeases && cfg.b("space.rule_lease_beats_purchase")) r -= leasedOn(zone, arrival); // priority 1 (setting): a signed rental beats a new purchase
    return Math.max(0, r - (promised.get(zone) ?? 0));
  };
  const pools = (it: Item) => [it.zone_id, ...(rentZones.has(it.zone_id) && it.zone_id !== overflow ? [overflow] : [])];
  const roomUnits = (it: Item, withLeases = true) => Math.floor(pools(it).reduce((a, z) => a + roomAt(z, it.lead_time_days, withLeases), 0) / it.space_m2_per_unit + 1e-9);
  const promise = (it: Item, area: number) => {
    let left = area;
    for (const z of pools(it)) { const t = Math.min(left, roomAt(z, it.lead_time_days)); promised.set(z, (promised.get(z) ?? 0) + t); left -= t; }
  };
  return { roomAt, pools, roomUnits, promise };
}

/** Agent 2 (REASON): reorder point, order quantity and budget-constrained prioritisation. Proposes PO drafts. */
export function replenishmentAgent(group: string, trigger: string): AgentResult {
  const started = new Date().toISOString();
  const d = db();
  const cfg = loadSettings();
  const sim = getSim();
  const now = { date: sim.sim_date, hour: sim.hour };
  const live = loadLive(cfg, now);
  const bud = budgetInfo();
  let remaining = bud.free;
  const startRemaining = remaining;
  const review = cfg.n("repl.review_days"), maxCover = cfg.n("repl.max_cover_weeks");
  const round = cfg.j<Record<string, number>>("repl.round_to");
  const prio = cfg.j<string[]>("repl.priority_categories");
  const cooldown = cfg.n("repl.reject_cooldown_hours"), dropRatio = cfg.n("repl.reopen_cover_drop");
  // criticality classes sort alphabetically (A = essential ... C = can wait); the first class may be trimmed to fit the budget
  const topCrit = ([...new Set([...live.values()].map((l) => l.item.criticality))].sort()[0]) ?? "";

  // ---- physical room: what the item's zone (plus the overflow zone for general goods) can still take when a new order arrives ----
  const room = roomModel(cfg, live, now);
  const { roomUnits, promise } = room;

  interface Cand {
    it: Item; l: Live; rop: number; position: number; qty: number; minQty: number; cost: number; rank: number; crit: string; urgency: number;
  }
  const cands: Cand[] = [];
  const skipped: Live[] = [];

  for (const l of live.values()) {
    const it = l.item;
    if (!l.fc) continue;
    if (l.cover > maxCover) { skipped.push(l); continue; } // overstock: never reorder
    const L = it.lead_time_days;
    const position = l.usable + poWithin(l.pos, now.date, L + review);
    const rop = reorderPoint(l.model, now, L, review, it.safety_stock);
    if (position > rop) continue;

    const coverDays = it.shelf_life_days
      ? Math.min(cfg.n("repl.target_cover_days"), Math.floor(it.shelf_life_days * cfg.n("repl.shelf_life_cover_ratio")))
      : cfg.n("repl.target_cover_days");
    const H = L + coverDays;
    let qty = roundUpTo(Math.max(0, demandOver(l.model, now, H * 24) + it.safety_stock - l.usable - poWithin(l.pos, now.date, H)), round[it.unit]);
    const cap = Math.floor(maxCover * l.weeklyUsage - l.usable - poWithin(l.pos, now.date, 100000));
    if (qty > cap) qty = Math.max(0, cap);
    if (qty <= 0) continue;
    const minQty = Math.min(qty, roundUpTo(Math.max(1, rop - position + demandOver(l.model, now, review * 24)), round[it.unit]));
    const lowCover = l.cover < 1 || l.onHand <= it.safety_stock;
    const urgency = lowCover ? 0 : prio.includes(it.category) ? 1 : 2;
    cands.push({ it, l, rop, position, qty, minQty, cost: qty * it.unit_cost_omr, rank: 0, crit: it.criticality, urgency });
  }

  cands.sort((a, b) => a.crit.localeCompare(b.crit) || a.urgency - b.urgency || a.l.cover - b.l.cover || a.it.item_id.localeCompare(b.it.item_id));
  cands.forEach((c, i) => (c.rank = i + 1));

  const plan: unknown[][] = [];
  const keep = new Set<string>();
  let funded = 0, deferred = 0, newCost = 0;

  for (const c of cands) {
    const { it, l } = c;
    const key = `PO:${it.item_id}`;
    const prior = recPayload(key);
    let reopen: Msg | null = null;
    if (prior?.status === "REJECTED") {
      const age = sim.tick - (prior.decided_tick ?? 0);
      const ctx = prior.payload.decision_ctx as { cover: number } | undefined;
      const worse = !!ctx && l.cover < ctx.cover * dropRatio;
      if (age >= cooldown) reopen = M("repl.reopen.cooldown", { hours: age });
      else if (worse) reopen = M("repl.reopen.worse", { from: ctx!.cover, to: l.cover });
      else {
        plan.push([it.item_id, c.rank, c.qty, c.minQty, c.cost, "REJECTED",
          JSON.stringify([M("repl.r.cooldown", { hours: Math.max(0, cooldown - age), age })]), c.rop, c.position, sim.tick]);
        continue;
      }
    }
    // cap by physical room: stage the order or flag that there is no room
    let staged: Msg | null = null;
    const step = round[it.unit] ?? 1;
    const fit = Math.floor(roomUnits(it) / step) * step;
    const need = c.qty;
    // room lost to signed leases (a lease beats a new purchase): what the zones would hold without tenants minus what they hold now
    const leasedM2 = fit < c.qty ? Math.max(0, room.roomUnits(it, false) - roomUnits(it)) * it.space_m2_per_unit : 0;
    if (fit < c.qty) {
      if (fit <= 0) {
        deferred++;
        plan.push([it.item_id, c.rank, c.qty, c.minQty, c.cost, "DEFERRED", JSON.stringify([M(leasedM2 > 0 ? "repl.r.noroom_leased" : "repl.r.noroom", { need: c.qty, unit: it.unit, leased: leasedM2 }), M("repl.r.below", { position: c.position, rop: c.rop, unit: it.unit, lead: it.lead_time_days })]), c.rop, c.position, sim.tick]);
        continue;
      }
      staged = M(leasedM2 > 0 ? "repl.r.staged_leased" : "repl.r.staged", { room: fit, need: c.qty, rest: c.qty - fit, unit: it.unit, leased: leasedM2 });
      c.qty = fit; c.minQty = Math.min(c.minQty, fit); c.cost = fit * it.unit_cost_omr;
    }
    const parts: Msg[] = [M("repl.r.below", { position: c.position, rop: c.rop, unit: it.unit, lead: it.lead_time_days })];
    if (l.fc!.season_factor > 1.05) parts.push(M("repl.r.season", { factor: l.fc!.season_factor }));
    parts.push(l.stockout ? M("repl.r.stockout", { hours: l.stockout.hours }) : M("repl.r.cover", { cover: l.cover }));

    if (staged) parts.push(staged);
    let status: "FUNDED" | "PARTIAL" | "DEFERRED";
    let qty = c.qty;
    if (c.cost <= remaining + 1e-9) status = "FUNDED";
    else if (c.crit === topCrit && c.minQty < c.qty && c.minQty * it.unit_cost_omr <= remaining + 1e-9) { status = "PARTIAL"; qty = c.minQty; }
    else status = "DEFERRED";
    const cost = qty * it.unit_cost_omr;

    if (status === "DEFERRED") {
      deferred++;
      plan.push([it.item_id, c.rank, c.qty, c.minQty, c.cost, "DEFERRED",
        JSON.stringify([M("repl.r.deferred", { cost: c.cost, left: Math.max(0, remaining), crit: it.criticality }), ...parts]), c.rop, c.position, sim.tick]);
      continue;
    }
    remaining -= cost; newCost += cost; funded++;
    promise(it, qty * it.space_m2_per_unit);
    const reason = status === "PARTIAL" ? [M("repl.r.partial", { qty: c.qty, cost: c.cost }), ...parts] : parts;
    plan.push([it.item_id, c.rank, qty, c.minQty, cost, status, JSON.stringify(reason), c.rop, c.position, sim.tick]);

    // a quantity edited by the user survives the hourly refresh
    const existing = recPayload(key);
    const edited = !!(existing?.status === "PENDING" && existing.payload.edited);
    const q = edited ? existing!.payload.qty : qty;
    const payload = {
      item_id: it.item_id, qty: q, suggested_qty: qty, edited, unit: it.unit, unit_cost: it.unit_cost_omr, cost: q * it.unit_cost_omr,
      supplier_id: it.supplier_id, lead_days: it.lead_time_days, expected_arrival: addDays(now.date, it.lead_time_days), priority: c.rank,
      status, reason, ctx: recContext(l), room: { need, qty, staged: !!staged, leased_m2: leasedM2 }, reopen_reason: reopen ?? existing?.payload.reopen_reason ?? null,
    };
    if (reopen) {
      reopenRec(key, payload);
      logEvent("REC_REOPENED", it.item_id, M("ev.rec_reopened", { item: it.item_id, why: reopen }), "high", { ref: key });
      keep.add(key);
    } else if (upsertRec(key, "PO", it.item_id, null, payload) === "PENDING") keep.add(key);
  }

  for (const l of skipped) {
    plan.push([l.item.item_id, 99, 0, 0, 0, "OVERSTOCK", JSON.stringify([M("repl.r.overstock", { cover: l.cover, limit: maxCover })]), 0, l.onHand, sim.tick]);
  }

  d.transaction(() => {
    d.prepare(`DELETE FROM replenishment_plan`).run();
    const st = d.prepare(`INSERT INTO replenishment_plan(item_id,rank,qty,min_qty,cost,status,reason,rop,position,updated_tick) VALUES(?,?,?,?,?,?,?,?,?,?)`);
    for (const r of plan) st.run(...r);
    // agent PO drafts that are no longer proposed are withdrawn (manual drafts are never touched)
    const stale = d.prepare(`SELECT key FROM recommendations WHERE kind='PO' AND status='PENDING' AND source='agent'`).all() as { key: string }[];
    for (const s of stale) if (!keep.has(s.key)) d.prepare(`DELETE FROM recommendations WHERE key=?`).run(s.key);
  })();

  const res: AgentResult = { msg: M("run.repl", { n: cands.length, funded, newCost, deferred, remaining, startRemaining, skipped: skipped.length }) };
  logRun(group, "replenishment", trigger, started, res.msg);
  return res;
}
