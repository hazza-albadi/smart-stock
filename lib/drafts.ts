// Ready-to-send drafts: the supplier order message of an approved purchase order, and the reply to the company for every space decision.
// Every number comes from the purchase-order / offer / decision records (no new calculation); texts are translatable messages {k, v}.
// A draft is never sent by the app: the manager edits the text if needed and marks it as sent.
import { db } from "./db";
import { getSim, M, type Msg } from "./core";
import { poValue } from "./calc";
import { budgetInfo } from "./budget";

export interface DraftRow {
  id: number; kind: "SUPPLIER_ORDER" | "SPACE_REPLY"; flow: "purchasing" | "space"; ref: string; to_name: string | null;
  subject: Msg; parts: Msg[]; body_override: { ar: string; en: string } | null; sent: number; created_tick: number; sent_tick: number | null; meta: Record<string, unknown>;
}

const one = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).get(...a) as T | undefined;

function insert(d: { kind: DraftRow["kind"]; flow: DraftRow["flow"]; ref: string; to: string | null; subject: Msg; parts: Msg[]; meta: Record<string, unknown> }): number {
  return db().prepare(`INSERT INTO drafts(kind,flow,ref,to_name,subject,parts,body_override,sent,created_tick,sent_tick,meta) VALUES(?,?,?,?,?,?,NULL,0,?,NULL,?)`)
    .run(d.kind, d.flow, d.ref, d.to, JSON.stringify(d.subject), JSON.stringify(d.parts), getSim().tick, JSON.stringify(d.meta)).lastInsertRowid as number;
}

/** The order message for a purchase order that now exists (approved agent order or manual / emergency order). One draft per order. */
export function createPoDraft(poId: string): number | null {
  if (one(`SELECT 1 FROM drafts WHERE kind='SUPPLIER_ORDER' AND ref=?`, poId)) return null;
  const po = one<{ po_id: string; item_id: string; supplier_id: string; quantity: number; expected_arrival: string; emergency: number; premium: number }>(`SELECT * FROM purchase_orders_open WHERE po_id=?`, poId);
  if (!po) return null;
  const it = one<{ unit: string; unit_cost_omr: number }>(`SELECT unit, unit_cost_omr FROM items WHERE item_id=?`, po.item_id);
  const sup = one<{ supplier_name: string }>(`SELECT supplier_name FROM suppliers WHERE supplier_id=?`, po.supplier_id);
  if (!it) return null;
  const bud = budgetInfo();
  const cost = poValue({ quantity: po.quantity, unit_cost: it.unit_cost_omr, premium: po.premium });
  const supplier = sup?.supplier_name ?? po.supplier_id;
  return insert({
    kind: "SUPPLIER_ORDER", flow: "purchasing", ref: poId, to: supplier,
    subject: M("draft.po.subject", { po: poId, qty: po.quantity, unit: it.unit, item: po.item_id }),
    parts: [M("draft.po.body", { supplier, po: poId, qty: po.quantity, unit: it.unit, item: po.item_id, date: po.expected_arrival, start: bud.start, end: bud.end, cost, emerg: po.emergency ? 1 : 0 })],
    meta: { po: poId, item_id: po.item_id, supplier_id: po.supplier_id, qty: po.quantity, arrival: po.expected_arrival, cost, emergency: !!po.emergency },
  });
}

export interface SpaceDraftIn {
  action: "accept" | "reject" | "counter" | "vacant"; decisionId: number; company?: string; zone: string;
  area: number; start: string; end: string; price?: number;
  /** why: the reason found by the automatic checks (or the manager's reason code), as a translatable message. */
  why?: Msg | null;
  counter?: { area: number; start: string; end: string; price: number };
  reeval?: string; note?: string; leaseId?: number;
}

/** Reply to the company for one space decision (accept, reject, counter-offer, keep vacant). The reason comes from the automatic checks. */
export function createSpaceDraft(i: SpaceDraftIn): number {
  const company = i.company ?? null;
  const base = { company: company ?? "", zone: i.zone, area: i.area, start: i.start, end: i.end, price: i.price ?? 0 };
  const why = i.why ?? M("draft.sp.why_generic");
  const [subject, body]: [Msg, Msg] =
    i.action === "accept" ? [M("draft.sp.accept.subject", base), M("draft.sp.accept.body", base)]
    : i.action === "reject" ? [M("draft.sp.reject.subject", base), M("draft.sp.reject.body", { ...base, why })]
    : i.action === "counter" ? [M("draft.sp.counter.subject", base), M("draft.sp.counter.body", { ...base, why, c_area: i.counter?.area ?? 0, c_start: i.counter?.start ?? "", c_end: i.counter?.end ?? "", c_price: i.counter?.price ?? 0 })]
    : [M("draft.sp.vacant.subject", base), M("draft.sp.vacant.body", { ...base, why, reeval: i.reeval ?? "", note: i.note ?? "" })];
  return insert({
    kind: "SPACE_REPLY", flow: "space", ref: `space:${i.decisionId}`, to: company, subject, parts: [body],
    meta: { action: i.action, decision: i.decisionId, zone: i.zone, area: i.area, lease: i.leaseId ?? null },
  });
}

const parse = (r: Record<string, any>): DraftRow => ({ ...r, subject: JSON.parse(r.subject), parts: JSON.parse(r.parts), body_override: r.body_override ? JSON.parse(r.body_override) : null, meta: r.meta ? JSON.parse(r.meta) : {} }) as DraftRow;

export const listDrafts = (limit: number): DraftRow[] => (db().prepare(`SELECT * FROM drafts ORDER BY id DESC LIMIT ?`).all(limit) as Record<string, any>[]).map(parse);

/** The manager edits the wording (both languages are kept) and / or marks the draft as sent or not sent. */
export function updateDraft(id: number, o: { body?: { ar: string; en: string }; sent?: boolean }) {
  const d = one<{ id: number }>(`SELECT id FROM drafts WHERE id=?`, id);
  if (!d) throw new Error("draft not found");
  if (o.body) {
    if (typeof o.body.ar !== "string" || typeof o.body.en !== "string") throw new Error("text expected");
    db().prepare(`UPDATE drafts SET body_override=? WHERE id=?`).run(JSON.stringify({ ar: o.body.ar, en: o.body.en }), id);
  }
  if (o.sent !== undefined) db().prepare(`UPDATE drafts SET sent=?, sent_tick=? WHERE id=?`).run(o.sent ? 1 : 0, o.sent ? getSim().tick : null, id);
}

/** An undone decision takes its draft with it. */
export const dropDrafts = (ref: string) => { db().prepare(`DELETE FROM drafts WHERE ref=?`).run(ref); };

/** Migration helper: orders approved before drafts existed get theirs too (so every approved order has a draft). */
export function backfillDrafts() {
  for (const r of db().prepare(`SELECT detail FROM decisions WHERE kind='PO' AND decision='APPROVED' ORDER BY id`).all() as { detail: string }[]) {
    const po = JSON.parse(r.detail ?? "{}").po as string | undefined;
    if (po) createPoDraft(po);
  }
}
