import { db } from "./db";
import { clockAt } from "./clock";
import { getSim, M, type Msg } from "./core";
import { budgetInfo } from "./agents/replenishment";
import { spaceImpact } from "./space/impact";

export interface ImpactRow {
  id: number; tick: number; kind: string; decision: string; item_id: string | null; request_id: string | null;
  head: Msg; effects: Msg[]; state: "effect" | "pending" | "none"; flow: "purchasing" | "space";
}

const all = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).all(...a) as T[];
const one = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).get(...a) as T | undefined;

/**
 * Decision impact log: for every stored decision, the consequences are read from the event chain, movements and demand log
 * (never written by hand). Example: "You rejected PO-X at ... -> item stocked out at ... -> production stopped for N hours".
 */
function purchasingImpact(limit = 60): ImpactRow[] {
  const sim = getSim();
  const when = (tick: number) => { const c = clockAt(sim.start_date, tick); return `${c.date}|${c.hour}`; };
  const rows = all(`SELECT * FROM decisions ORDER BY tick DESC, id DESC LIMIT ?`, limit);
  const unmetHours = (item: string, from: number, to: number) =>
    one<{ c: number }>(`SELECT COUNT(*) c FROM demand_log WHERE item_id=? AND planned>issued AND day*24+hour>=? AND day*24+hour<?`, item, from, to)?.c ?? 0;
  const firstStockout = (item: string, from: number, to: number) =>
    one<{ tick: number }>(`SELECT tick FROM events WHERE type='STOCKOUT' AND item_id=? AND tick>=? AND tick<? ORDER BY tick LIMIT 1`, item, from, to)?.tick;
  const nameOf = (id: string | null) => id;

  return rows.map((r): ImpactRow => {
    const d = JSON.parse(r.detail ?? "{}");
    const effects: Msg[] = [];
    let head: Msg;
    let state: ImpactRow["state"] = "effect";
    const w = when(r.tick);

    if (r.kind === "PO" && r.decision === "APPROVED") {
      head = M("impact.head.po_approved", { po: d.po, qty: d.qty, item: r.item_id, when: w });
      effects.push(M("impact.e.po_cost", { cost: d.cost }));
      const arr = one(`SELECT tick, msg FROM events WHERE type='PO_ARRIVED' AND ref=? ORDER BY tick LIMIT 1`, d.po);
      const arrTick = arr?.tick as number | undefined;
      if (arrTick !== undefined) {
        const mv = one(`SELECT quantity, balance_after FROM stock_movements WHERE reference=? AND movement_type='IN' ORDER BY seq LIMIT 1`, d.po);
        effects.push(M("impact.e.po_arrived", { when: when(arrTick), qty: mv?.quantity ?? d.qty, from: (mv?.balance_after ?? 0) - (mv?.quantity ?? 0), to: mv?.balance_after ?? 0, item: r.item_id }));
        if (one(`SELECT 1 FROM events WHERE type IN ('PO_OVERFLOW','PO_HELD') AND ref=?`, d.po)) effects.push(M("impact.e.po_space", { po: d.po }));
        const so = firstStockout(r.item_id, r.tick, arrTick);
        if (so !== undefined) effects.push(M("impact.e.stockout_before", { item: r.item_id, when: when(so), hours: unmetHours(r.item_id, r.tick, arrTick) }));
        else effects.push(M("impact.e.no_stockout_before", { item: r.item_id }));
      } else {
        effects.push(M("impact.e.po_pending", { when: `${d.arrival}|${d.hour}` }));
        const so = firstStockout(r.item_id, r.tick, sim.tick + 1);
        if (so !== undefined) effects.push(M("impact.e.stockout_waiting", { item: r.item_id, when: when(so), hours: unmetHours(r.item_id, r.tick, sim.tick + 1) }));
      }
      if (d.over_budget) effects.push(M("impact.e.over_budget", { free: budgetInfo().free }));
      for (const e of all(`SELECT tick FROM events WHERE type IN ('SPACE_CONFLICT','OFFER_BLOCKED') AND json_extract(meta,'$.po')=? ORDER BY tick LIMIT 3`, d.po)) effects.push(M("impact.e.po_space_conflict", { when: when(e.tick) }));
    } else if (r.kind === "PO" && r.decision === "REJECTED") {
      head = M("impact.head.po_rejected", { item: r.item_id, qty: d.qty, when: w });
      const so = firstStockout(r.item_id, r.tick, sim.tick + 1);
      if (so !== undefined) {
        const restored = one(`SELECT tick FROM stock_movements WHERE item_id=? AND movement_type='IN' AND sim=1 AND tick>? ORDER BY tick LIMIT 1`, r.item_id, so)?.tick as number | undefined;
        const end = restored ?? sim.tick + 1;
        effects.push(M("impact.e.stockout_after_reject", { item: r.item_id, when: when(so), hours: unmetHours(r.item_id, so, end), ongoing: restored === undefined ? 1 : 0 }));
      } else effects.push(M("impact.e.no_stockout", { item: r.item_id, cover: d.cover ?? 0 }));
      for (const e of all(`SELECT tick, msg FROM events WHERE type='REC_REOPENED' AND item_id=? AND tick>=? ORDER BY tick LIMIT 2`, r.item_id, r.tick)) {
        const m = JSON.parse(e.msg);
        effects.push(M("impact.e.reopened", { when: when(e.tick), why: m.v?.why }));
      }
    } else if (r.kind === "PO_EDIT") {
      head = M("impact.head.po_edit", { item: r.item_id, from: d.before, to: d.after, when: w });
      effects.push(M("impact.e.edit_effect"));
    } else if (r.kind === "PO_MANUAL") {
      head = M("impact.head.po_manual", { item: r.item_id, qty: d.qty, when: w });
      effects.push(M("impact.e.manual_po"));
    } else if (r.kind === "SUPPLIER_MSG") {
      head = M("impact.head.msg", { item: r.item_id, decision: r.decision, when: w });
      state = "none";
      effects.push(M("impact.none.msg"));
    } else if (r.kind === "MANUAL_MOVEMENT") {
      const mv = one(`SELECT balance_after, quantity, movement_type FROM stock_movements WHERE item_id=? AND tick=? AND actor='user' ORDER BY seq DESC LIMIT 1`, r.item_id, r.tick);
      head = M("impact.head.manual", { item: r.item_id, kind: String(r.decision).toLowerCase(), qty: d.moved ?? d.qty, when: w });
      if (mv) effects.push(M("impact.e.manual_stock", { item: r.item_id, to: mv.balance_after, sign: mv.movement_type === "IN" ? 1 : -1, qty: mv.quantity }));
      else effects.push(M("impact.e.manual_stock_none"));
    } else if (r.kind === "SPACE_REQUEST_NEW") {
      head = M("impact.head.request", { req: r.request_id, when: w });
      effects.push(M("impact.e.request_proposal"));
    } else {
      head = M("impact.head.generic", { kind: r.kind, when: w });
      state = "none";
    }
    void nameOf;
    return { id: r.id, tick: r.tick, kind: r.kind, decision: r.decision, item_id: r.item_id, request_id: r.request_id, head, effects, state, flow: "purchasing" };
  });
}

/** Both flows in one list, newest first; every entry carries its flow. */
export function impactLog(limit = 60): ImpactRow[] {
  const sp = spaceImpact(limit) as unknown as ImpactRow[];
  return [...purchasingImpact(limit), ...sp].sort((a, b) => b.tick - a.tick || (a.flow === b.flow ? b.id - a.id : a.flow === "space" ? -1 : 1)).slice(0, limit);
}
