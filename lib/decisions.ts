import { db } from "./db";
import { addDays, addMonths } from "./time";
import { clockAt, tickOf } from "./clock";
import { deliveryHour } from "./calc";
import { getSim, getItems, logEvent, M, UserError, type Item, type Msg } from "./core";
import { loadSettings } from "./settings";
import { loadLive } from "./live";
import { recContext, roomModel } from "./agents/replenishment";
import { budgetInfo, recordTopup, removeTopup } from "./budget";
import { runAll } from "./agents/coordinator";
import { issueFefo, receiveGoods, totalOnHand } from "./stock";

interface RecRow { id: number; key: string; kind: string; item_id: string | null; request_id: string | null; payload: string; status: string; created_tick: number }

const audit = (kind: string, o: { rec?: RecRow; item?: string | null; req?: string | null; decision: string; ref?: string | null; detail?: unknown; actor?: string }) => {
  const s = getSim();
  return db().prepare(`INSERT INTO decisions(tick,ts,rec_id,rec_key,kind,item_id,request_id,decision,actor,ref,detail) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(s.tick, new Date().toISOString(), o.rec?.id ?? null, o.rec?.key ?? null, kind, o.item ?? o.rec?.item_id ?? null, o.req ?? o.rec?.request_id ?? null,
      o.decision, o.actor ?? "user", o.ref ?? null, JSON.stringify(o.detail ?? {})).lastInsertRowid as number;
};

function placePo(item: Item, qty: number, o: { emergency: boolean; recKey: string | null; source: string }): { poId: string; arrival: string; hour: number; cost: number; over: boolean } {
  const d = db();
  const cfg = loadSettings();
  const s = getSim();
  const lead = o.emergency ? Math.max(1, Math.round(item.lead_time_days * cfg.n("po.emergency_lead_factor"))) : item.lead_time_days;
  const premium = o.emergency ? cfg.n("po.emergency_premium") : 0;
  const stamp = s.sim_date.slice(2).replace(/-/g, "");
  let poId = `PO-${item.item_id.slice(item.item_id.indexOf("-") + 1)}-${stamp}`, n = 1;
  while (d.prepare(`SELECT 1 FROM purchase_orders_open WHERE po_id=?`).get(poId)) poId = `PO-${item.item_id.slice(item.item_id.indexOf("-") + 1)}-${stamp}-${++n}`;
  let arrival = addDays(s.sim_date, lead);
  const hour = deliveryHour(cfg.n("sim.seed"), poId, cfg.n("delivery.window_start_hour"), cfg.n("delivery.window_end_hour"));
  if (tickOf(s.start_date, arrival, hour) <= s.tick) arrival = addDays(arrival, 1);
  d.prepare(`INSERT INTO purchase_orders_open(po_id,item_id,supplier_id,quantity,order_date,expected_arrival,status,source,received_date,expected_hour,ordered_tick,received_tick,emergency,premium,rec_key)
    VALUES(?,?,?,?,?,?,'OPEN',?,NULL,?,?,NULL,?,?,?)`).run(poId, item.item_id, item.supplier_id, qty, s.sim_date, arrival, o.source, hour, s.tick, o.emergency ? 1 : 0, premium, o.recKey);
  const cost = qty * item.unit_cost_omr * (1 + premium);
  return { poId, arrival, hour, cost, over: false };
}

export interface DecideOpts { qty?: number; variant?: "primary" | "split"; area?: number }

/** Human in the loop: the AI only proposes. Every decision is stored with its simulated time and changes later hours (PO placed, lease reserved ...). */
export function decide(id: number, decision: "APPROVED" | "REJECTED", opts: DecideOpts = {}) {
  const d = db();
  const rec = d.prepare(`SELECT * FROM recommendations WHERE id=?`).get(id) as RecRow | undefined;
  if (!rec) throw new Error("recommendation not found");
  if (rec.status !== "PENDING") throw new Error("already decided");
  const s = getSim();
  const p = JSON.parse(rec.payload);
  const ok = decision === "APPROVED";
  const cfg = loadSettings();
  let decisionId = 0;
  let roomUnits: number | null = null, capped: number | null = null;

  d.transaction(() => {
    let detail: Record<string, unknown> = {};
    let ref: string | null = null;
    if (rec.kind === "PO") {
      const it = getItems().find((i) => i.item_id === rec.item_id) as Item;
      const live = loadLive(cfg, { date: s.sim_date, hour: s.hour }).get(it.item_id);
      const ctx = live ? recContext(live) : p.ctx;
      if (ok) {
        let qty = Math.max(1, Math.floor(opts.qty ?? p.qty));
        // same-hour collision: a lease signed meanwhile may have taken the room this order needs; checked inside this transaction
        const rm = roomModel(cfg, loadLive(cfg, { date: s.sim_date, hour: s.hour }), { date: s.sim_date, hour: s.hour });
        const withLeases = rm.roomUnits(it), without = rm.roomUnits(it, false);
        if (qty > withLeases && qty <= without) throw new UserError(M("sp.err.po_collision", { item: it.item_id, qty, max: withLeases, unit: it.unit }));
        // respect zone room: an agent order is never placed for more than the zones will hold when it arrives (manual orders are the manager's own responsibility)
        roomUnits = withLeases;
        if (p.status !== "MANUAL" && qty > withLeases) {
          const step = cfg.j<Record<string, number>>("repl.round_to")[it.unit] ?? 1;
          const fit = Math.floor(withLeases / step) * step;
          if (fit < 1) throw new UserError(M("repl.err.no_room", { item: it.item_id, unit: it.unit }));
          capped = qty; qty = fit;
        }
        // money: anything above the free budget is emergency spend, which has a limit per period (setting); above it the order is refused with a way out
        const prem = p.emergency ? cfg.n("po.emergency_premium") : 0;
        const orderCost = qty * it.unit_cost_omr * (1 + prem);
        const bud = budgetInfo();
        const extra = Math.max(0, orderCost - Math.max(0, bud.free));
        if (extra > bud.emergencyRoom + 1e-9) {
          const fit = Math.floor((Math.max(0, bud.free) + bud.emergencyRoom) / (it.unit_cost_omr * (1 + prem)));
          throw new UserError(M("budget.err.over_limit", { extra, room: bud.emergencyRoom, max: fit, unit: it.unit, item: it.item_id, date: bud.nextStart }));
        }
        const r = placePo(it, qty, { emergency: !!p.emergency, recKey: rec.key, source: "AGENT" });
        if (extra > 1e-9) {
          recordTopup(extra, { po: r.poId, item: it.item_id, reason: "emergency" });
          logEvent("BUDGET_TOPUP", it.item_id, M("ev.budget_topup", { po: r.poId, amount: extra, item: it.item_id }), "high", { ref: r.poId, actor: "user" });
        }
        ref = r.poId;
        detail = { po: r.poId, qty, suggested: p.suggested_qty ?? p.qty, cost: r.cost, arrival: r.arrival, hour: r.hour, over_budget: false, emergency_spend: extra, room_units: roomUnits, capped_from: capped, manual: p.status === "MANUAL", cover: ctx?.cover, stockout_hours: ctx?.stockout_hours };
        logEvent("PO_APPROVED", it.item_id, M("ev.po_approved", { po: r.poId, qty, unit: it.unit, item: it.item_id, cost: r.cost, date: r.arrival, hour: r.hour }), "info", { ref: r.poId, actor: "user" });
        d.prepare(`UPDATE recommendations SET status='APPROVED', decided_tick=?, key=key||'#'||id, payload=? WHERE id=?`).run(s.tick, JSON.stringify({ ...p, qty, cost: r.cost, po_id: r.poId }), id);
      } else {
        detail = { cover: ctx?.cover, stockout_hours: ctx?.stockout_hours, qty: p.qty };
        logEvent("PO_REJECTED", it.item_id, M("ev.po_rejected", { item: it.item_id, qty: p.qty, unit: it.unit }), "info", { ref: rec.key, actor: "user" });
        d.prepare(`UPDATE recommendations SET status='REJECTED', decided_tick=?, payload=? WHERE id=?`).run(s.tick, JSON.stringify({ ...p, decision_ctx: ctx }), id);
      }
    } else if (rec.kind === "SUPPLIER_MSG") {
      detail = { effect: "none" };
      logEvent("MSG", rec.item_id, M(ok ? "ev.msg_approved" : "ev.msg_rejected", { supplier: p.supplier_name }), "info", { ref: rec.key, actor: "user" });
      d.prepare(`UPDATE recommendations SET status=?, decided_tick=? WHERE id=?`).run(decision, s.tick, id);
    }
    decisionId = audit(rec.kind, { rec, decision, ref, detail });
  })();

  // agents react to the decision: plan / budget, alerts, space matching of the other requests
  runAll({ group: `${s.tick}#decision`, trigger: "decision" });
  return { rec: d.prepare(`SELECT * FROM recommendations WHERE id=?`).get(id), decisionId };
}

/** Postpone: hide the recommendation for a while (it keeps ageing, no overdue alert meanwhile). */
export function postpone(id: number, untilTick?: number) {
  const d = db();
  const rec = d.prepare(`SELECT * FROM recommendations WHERE id=?`).get(id) as RecRow | undefined;
  if (!rec || rec.status !== "PENDING") throw new Error("only a pending recommendation can be postponed");
  const s = getSim();
  const hours = untilTick !== undefined && untilTick > s.tick ? untilTick - s.tick : loadSettings().n("rec.postpone_hours");
  const p = JSON.parse(rec.payload);
  d.transaction(() => {
    d.prepare(`UPDATE recommendations SET payload=? WHERE id=?`).run(JSON.stringify({ ...p, snooze_until: s.tick + hours }), id);
    audit(rec.kind, { rec, decision: "POSTPONED", detail: { effect: "none", until: s.tick + hours } });
    logEvent("POSTPONED", rec.item_id, M("ev.postponed", { what: rec.kind, item: rec.item_id ?? "", req: rec.request_id ?? "", hours }), "info", { ref: rec.key, actor: "user" });
  })();
}

/** Undo an approval / rejection while its effects can still be reversed (PO not received yet, no later change of the same lease ...). */
export function undo(decisionId: number) {
  const d = db();
  const dec = d.prepare(`SELECT * FROM decisions WHERE id=?`).get(decisionId) as { id: number; rec_id: number; kind: string; decision: string; detail: string; request_id: string | null } | undefined;
  if (!dec || !dec.rec_id) throw new Error("this decision cannot be undone");
  const rec = d.prepare(`SELECT * FROM recommendations WHERE id=?`).get(dec.rec_id) as RecRow | undefined;
  if (!rec) throw new Error("this decision cannot be undone");
  const det = JSON.parse(dec.detail ?? "{}");
  const s = getSim();
  d.transaction(() => {
    const p = JSON.parse(rec.payload);
    if (dec.kind === "PO" && dec.decision === "APPROVED") {
      const po = d.prepare(`SELECT * FROM purchase_orders_open WHERE po_id=?`).get(det.po) as { status: string } | undefined;
      if (!po || po.status !== "OPEN") throw new Error("the order has already arrived or changed");
      d.prepare(`DELETE FROM purchase_orders_open WHERE po_id=?`).run(det.po);
      removeTopup(det.po);
      const base = rec.key.replace(/#\d+$/, "");
      d.prepare(`DELETE FROM recommendations WHERE key=? AND id<>?`).run(base, rec.id);
      delete p.po_id;
      d.prepare(`UPDATE recommendations SET status='PENDING', key=?, decided_tick=NULL, payload=? WHERE id=?`).run(base, JSON.stringify({ ...p, cost: p.qty * p.unit_cost * (1 + (p.emergency ? loadSettings().n("po.emergency_premium") : 0)) }), rec.id);
    } else if (dec.decision === "REJECTED" || dec.kind === "SUPPLIER_MSG") {
      delete p.decision_ctx;
      d.prepare(`UPDATE recommendations SET status='PENDING', decided_tick=NULL, payload=? WHERE id=?`).run(JSON.stringify(p), rec.id);
    } else throw new Error("this decision cannot be undone");
    d.prepare(`DELETE FROM decisions WHERE id=?`).run(dec.id);
    logEvent("UNDO", rec.item_id, M("ev.undo", { what: rec.kind, item: rec.item_id ?? "", req: rec.request_id ?? "" }), "info", { ref: rec.key, actor: "user" });
  })();
  runAll({ group: `${s.tick}#undo`, trigger: "decision" });
}

/** Edit the quantity of a pending PO draft before approving it. */
export function editQty(id: number, qty: number) {
  const d = db();
  const rec = d.prepare(`SELECT * FROM recommendations WHERE id=?`).get(id) as RecRow | undefined;
  if (!rec || rec.kind !== "PO" || rec.status !== "PENDING") throw new Error("only a pending PO draft can be edited");
  if (!(qty >= 1)) throw new Error("quantity must be at least 1");
  const p = JSON.parse(rec.payload);
  const prem = p.emergency ? loadSettings().n("po.emergency_premium") : 0;
  const before = p.qty;
  const q = Math.floor(qty);
  d.transaction(() => {
    d.prepare(`UPDATE recommendations SET payload=? WHERE id=?`).run(JSON.stringify({ ...p, qty: q, cost: q * p.unit_cost * (1 + prem), edited: true }), id);
    audit("PO_EDIT", { rec, decision: "EDIT_QTY", detail: { before, after: q } });
    logEvent("PO_EDITED", rec.item_id, M("ev.po_edited", { item: rec.item_id, from: before, to: q, unit: p.unit }), "info", { ref: rec.key, actor: "user" });
  })();
}

/** Manual (e.g. emergency) purchase order draft; it goes through the same approval and the same budget. */
export function createManualPo(itemId: string, qty: number, emergency: boolean) {
  const d = db();
  const it = getItems().find((i) => i.item_id === itemId);
  if (!it) throw new Error("unknown item");
  if (!(qty >= 1)) throw new Error("quantity must be at least 1");
  const cfg = loadSettings();
  const s = getSim();
  const lead = emergency ? Math.max(1, Math.round(it.lead_time_days * cfg.n("po.emergency_lead_factor"))) : it.lead_time_days;
  const prem = emergency ? cfg.n("po.emergency_premium") : 0;
  const n = (d.prepare(`SELECT COUNT(*) c FROM recommendations WHERE key LIKE ?`).get(`PO:${itemId}#M%`) as { c: number }).c + 1;
  const live = loadLive(cfg, { date: s.sim_date, hour: s.hour }).get(itemId);
  const payload = {
    item_id: itemId, qty: Math.floor(qty), suggested_qty: Math.floor(qty), edited: true, unit: it.unit, unit_cost: it.unit_cost_omr,
    cost: Math.floor(qty) * it.unit_cost_omr * (1 + prem), supplier_id: it.supplier_id, lead_days: lead, expected_arrival: addDays(s.sim_date, lead),
    priority: 0, status: "MANUAL", emergency, reason: [M(emergency ? "repl.r.manual_emergency" : "repl.r.manual", { lead, premium: prem })], ctx: live ? recContext(live) : null,
  };
  d.transaction(() => {
    d.prepare(`INSERT INTO recommendations(key,kind,item_id,request_id,payload,status,created_tick,source) VALUES(?,?,?,?,?,'PENDING',?,'manual')`)
      .run(`PO:${itemId}#M${n}`, "PO", itemId, null, JSON.stringify(payload), s.tick);
    audit("PO_MANUAL", { item: itemId, decision: emergency ? "CREATE_EMERGENCY" : "CREATE", detail: { qty: payload.qty } });
    logEvent("PO_CREATED", itemId, M("ev.po_created", { item: itemId, qty: payload.qty, unit: it.unit, emergency: emergency ? 1 : 0 }), "info", { actor: "user" });
  })();
  runAll({ group: `${s.tick}#manual`, trigger: "manual" });
}

/** Manual stock movement with a reason: receipt, issue or adjustment (signed). Same tables, same agents, audited. */
export function manualMovement(o: { item: string; kind: "receipt" | "issue" | "adjust"; qty: number; reason: string }) {
  const d = db();
  const cfg = loadSettings();
  const it = getItems().find((i) => i.item_id === o.item);
  if (!it) throw new Error("unknown item");
  if (!o.reason.trim()) throw new Error("a reason is required");
  const qty = Math.floor(o.qty);
  if (!Number.isFinite(qty) || qty === 0 || (o.kind !== "adjust" && qty < 0)) throw new Error("invalid quantity");
  const s = getSim();
  const ref = `MANUAL:${o.kind}:${o.reason.trim().slice(0, 60)}`;
  let moved = 0;
  d.transaction(() => {
    if (o.kind === "receipt" || (o.kind === "adjust" && qty > 0)) {
      const r = receiveGoods(cfg, it, Math.abs(qty), s.sim_date, `MAN${s.tick}`, "user");
      if (r.got === 0) throw new Error("no room in the warehouse for this receipt");
      moved = r.got;
      d.prepare(`UPDATE stock_movements SET reference=? WHERE seq IN (SELECT seq FROM stock_movements WHERE tick=? AND actor='user' AND item_id=? AND reference=?)`).run(ref, s.tick, it.item_id, `MAN${s.tick}`);
    } else {
      const have = totalOnHand(it.item_id);
      if (Math.abs(qty) > have) throw new Error("not enough stock");
      moved = issueFefo(it, Math.abs(qty), s.sim_date, ref, "user");
    }
    audit("MANUAL_MOVEMENT", { item: it.item_id, decision: o.kind.toUpperCase(), detail: { qty, moved, reason: o.reason } });
    logEvent("MANUAL_MOVEMENT", it.item_id, M("ev.manual_movement", { kind: o.kind, qty: moved, sign: o.kind === "issue" || qty < 0 ? -1 : 1, unit: it.unit, item: it.item_id, reason: o.reason }), "info", { actor: "user" });
  })();
  runAll({ group: `${s.tick}#manual`, trigger: "manual" });
  return moved;
}

/** A potential tenant is added to the pool (test data). It stays invisible until a published listing attracts it. */
export function createSpaceRequest(o: { company: string; type: string; area: number; months: number; from: string }) {
  const d = db();
  const s = getSim();
  if (!o.company.trim() || !(o.area > 0) || !(o.months >= 1) || !/^\d{4}-\d{2}-\d{2}$/.test(o.from)) throw new Error("invalid request");
  const n = (d.prepare(`SELECT COUNT(*) c FROM space_requests WHERE source='MANUAL'`).get() as { c: number }).c + 1;
  const id = `NEW-${String(n).padStart(2, "0")}`;
  d.transaction(() => {
    d.prepare(`INSERT INTO space_requests(request_id,company,required_storage_type,area_needed_m2,duration_months,needed_from,notes,source,created_tick) VALUES(?,?,?,?,?,?,?,'MANUAL',?)`)
      .run(id, o.company.trim(), o.type, o.area, Math.floor(o.months), o.from, "", s.tick);
    audit("SPACE_REQUEST_NEW", { req: id, decision: "CREATE", detail: o });
    logEvent("SPACE_REQUEST", null, M("ev.space_request", { req: id, company: o.company, area: o.area, from: o.from }), "info", { ref: id, actor: "user" });
  })();
  return id;
}

export { clockAt };
export type { Msg };
