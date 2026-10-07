import { db } from "../db";
import { addDays, diffDays } from "../time";
import { seasonFactor } from "../seasonality";
import { getItems, getSim, logRun, upsertRec, fmt, type AgentResult, type ForecastRow, type Item, type Po, uAr} from "../core";

export const REVIEW_DAYS = 14; // two-week review cycle added to the lead time (periodic-review reorder point)
export const MAX_COVER_WEEKS = 12; // never reorder above this cover
const TARGET_COVER_DAYS = 56; // order enough for lead time + 8 weeks (shorter for perishables)
const REJECT_SUPPRESS_DAYS = 7;

export function budgetInfo() {
  const b = db().prepare(`SELECT * FROM purchasing_budget LIMIT 1`).get() as {
    period_start: string; period_end: string; total_purchasing_budget_omr: number;
  };
  const committed = (db().prepare(`SELECT COALESCE(SUM(p.quantity*i.unit_cost_omr),0) c FROM purchase_orders_open p
    JOIN items i ON i.item_id=p.item_id`).get() as { c: number }).c;
  return { total: b.total_purchasing_budget_omr, start: b.period_start, end: b.period_end, committed };
}

/** Agent 2 (REASON): reorder point, order quantity and budget-constrained prioritisation. Proposes PO drafts. */
export function replenishmentAgent(group: string): AgentResult {
  const started = new Date().toISOString();
  const d = db();
  const sim = getSim();
  const today = sim.sim_date;
  const items = getItems();
  const fc = new Map((d.prepare(`SELECT * FROM forecasts`).all() as ForecastRow[]).map((f) => [f.item_id, f]));
  const pos = d.prepare(`SELECT * FROM purchase_orders_open WHERE status IN ('OPEN','DELAYED_BY_SUPPLIER')`).all() as Po[];
  const bud = budgetInfo();
  let remaining = bud.total - bud.committed;
  const startRemaining = remaining;

  interface Cand {
    it: Item; f: ForecastRow; rop: number; position: number; qty: number; minQty: number; cost: number; rank: number;
    crit: number; urgency: number; poLater: number; lowCover: boolean;
  }
  const cands: Cand[] = [];
  const skipped: { it: Item; f: ForecastRow }[] = [];

  for (const it of items) {
    const f = fc.get(it.item_id);
    if (!f) continue;
    const demand = (days: number) => {
      let s = 0;
      for (let i = 0; i < days; i++) s += (f.base_weekly / 7) * seasonFactor(it.item_id, addDays(today, i));
      return s;
    };
    if (f.weeks_cover > MAX_COVER_WEEKS) { skipped.push({ it, f }); continue; } // overstock: never reorder

    const L = it.lead_time_days;
    const within = (days: number) =>
      pos.filter((p) => p.item_id === it.item_id && diffDays(p.expected_arrival, today) <= days).reduce((a, p) => a + p.quantity, 0);
    const position = f.usable_qty + within(L + REVIEW_DAYS);
    const rop = demand(L + REVIEW_DAYS) + it.safety_stock;
    if (position > rop) continue;

    const cover = it.shelf_life_days ? Math.min(TARGET_COVER_DAYS, Math.floor(it.shelf_life_days / 2)) : TARGET_COVER_DAYS;
    const H = L + cover;
    const roundUp = (q: number) => (it.unit === "kg" ? Math.ceil(q / 10) * 10 : Math.ceil(q));
    let qty = roundUp(Math.max(0, demand(H) + it.safety_stock - f.usable_qty - within(H)));
    const cap = Math.floor(MAX_COVER_WEEKS * f.weekly_usage - f.usable_qty - within(1000));
    if (qty > cap) qty = Math.max(0, cap);
    if (qty <= 0) continue;
    const minQty = Math.min(qty, roundUp(Math.max(1, rop - position + demand(REVIEW_DAYS))));

    const lowCover = f.weeks_cover < 1 || f.on_hand <= it.safety_stock;
    const crit = "ABC".indexOf(it.criticality);
    // within a criticality class: stock-out risk first, then safety gear & chemicals, then the rest
    const urgency = lowCover ? 0 : ["Safety gear", "Chemicals"].includes(it.category) ? 1 : 2;
    cands.push({ it, f, rop, position, qty, minQty, cost: qty * it.unit_cost_omr, rank: 0, crit, urgency,
      poLater: pos.filter((p) => p.item_id === it.item_id).reduce((a, p) => a + p.quantity, 0), lowCover });
  }

  cands.sort((a, b) => a.crit - b.crit || a.urgency - b.urgency || a.f.weeks_cover - b.f.weeks_cover);
  cands.forEach((c, i) => (c.rank = i + 1));

  const plan: unknown[][] = [];
  const keep = new Set<string>();
  let funded = 0, deferred = 0, newCost = 0;

  for (const c of cands) {
    const { it, f } = c;
    const key = `PO:${it.item_id}`;
    const prior = d.prepare(`SELECT status, decided_sim_date FROM recommendations WHERE key=?`).get(key) as
      { status: string; decided_sim_date: string | null } | undefined;
    if (prior?.status === "REJECTED" && prior.decided_sim_date && diffDays(today, prior.decided_sim_date) < REJECT_SUPPRESS_DAYS) {
      plan.push([it.item_id, c.rank, c.qty, c.minQty, c.cost, "REJECTED",
        `Draft rejected on ${prior.decided_sim_date}; not re-proposed for ${REJECT_SUPPRESS_DAYS} days.`,
        `تم رفض المسودة بتاريخ ${prior.decided_sim_date}؛ لا تُقترح مجدداً قبل ${REJECT_SUPPRESS_DAYS} أيام.`, c.rop, c.position, today]);
      continue;
    }
    const why = {
      en: `Position ${fmt(c.position)} ${it.unit} is below the reorder point ${fmt(c.rop)} (lead time ${it.lead_time_days}d` +
        `${f.season_factor > 1.05 ? `, season x${f.season_factor.toFixed(2)}` : ""}); ${f.stockout_date ? `projected stock-out ${f.stockout_date}` : `cover ${f.weeks_cover.toFixed(1)} wk`}.`,
      ar: `الرصيد المتوقع ${fmt(c.position)} ${uAr(it.unit)} أقل من نقطة إعادة الطلب ${fmt(c.rop)} (مدة التوريد ${it.lead_time_days} يوم` +
        `${f.season_factor > 1.05 ? `، موسمية ×${f.season_factor.toFixed(2)}` : ""}); ${f.stockout_date ? `النفاد المتوقع ${f.stockout_date}` : `التغطية ${f.weeks_cover.toFixed(1)} أسبوع`}.`,
    };
    let status: "FUNDED" | "PARTIAL" | "DEFERRED";
    let qty = c.qty;
    if (c.cost <= remaining + 1e-9) status = "FUNDED";
    else if (it.criticality === "A" && c.minQty < c.qty && c.minQty * it.unit_cost_omr <= remaining + 1e-9) { status = "PARTIAL"; qty = c.minQty; }
    else status = "DEFERRED";
    const cost = qty * it.unit_cost_omr;

    if (status === "DEFERRED") {
      deferred++;
      plan.push([it.item_id, c.rank, c.qty, c.minQty, c.cost, "DEFERRED",
        `Needs ${fmt(c.cost, 0)} OMR but only ${fmt(Math.max(0, remaining), 0)} OMR is left after higher-priority lines (criticality ${it.criticality}). ${why.en}`,
        `يحتاج ${fmt(c.cost, 0)} ر.ع بينما المتبقي ${fmt(Math.max(0, remaining), 0)} ر.ع بعد البنود الأعلى أولوية (الأهمية ${it.criticality}). ${why.ar}`,
        c.rop, c.position, today]);
      continue;
    }
    remaining -= cost; newCost += cost; funded++;
    const reasonEn = status === "PARTIAL"
      ? `Reduced to the minimum quantity that restores the reorder point within the remaining budget (full order ${fmt(c.qty)} would cost ${fmt(c.cost, 0)} OMR). ${why.en}`
      : why.en;
    const reasonAr = status === "PARTIAL"
      ? `خُفّضت الكمية إلى الحد الأدنى الذي يعيد نقطة إعادة الطلب ضمن الميزانية المتبقية (الطلب الكامل ${fmt(c.qty)} بتكلفة ${fmt(c.cost, 0)} ر.ع). ${why.ar}`
      : why.ar;
    plan.push([it.item_id, c.rank, qty, c.minQty, cost, status, reasonEn, reasonAr, c.rop, c.position, today]);
    const stored = upsertRec(key, "PO", it.item_id, null, {
      item_id: it.item_id, qty, unit: it.unit, unit_cost: it.unit_cost_omr, cost, supplier_id: it.supplier_id,
      expected_arrival: addDays(today, it.lead_time_days), priority: c.rank, status, reason_en: reasonEn, reason_ar: reasonAr,
    });
    if (stored === "PENDING") keep.add(key);
  }

  for (const { it, f } of skipped) {
    plan.push([it.item_id, 99, 0, 0, 0, "OVERSTOCK",
      `Not reordered: ${f.weeks_cover.toFixed(1)} weeks of cover is above the ${MAX_COVER_WEEKS}-week limit.`,
      `لا يُعاد طلبه: تغطية ${f.weeks_cover.toFixed(1)} أسبوعاً تتجاوز حد ${MAX_COVER_WEEKS} أسبوعاً.`, 0, f.on_hand, today]);
  }

  d.transaction(() => {
    d.prepare(`DELETE FROM replenishment_plan`).run();
    const st = d.prepare(`INSERT INTO replenishment_plan(item_id,rank,qty,min_qty,cost,status,reason_en,reason_ar,rop,position,updated_sim_date)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    for (const r of plan) st.run(...r);
    // PO drafts that are no longer proposed are withdrawn
    const stale = d.prepare(`SELECT key FROM recommendations WHERE kind='PO' AND status='PENDING'`).all() as { key: string }[];
    for (const s of stale) if (!keep.has(s.key)) d.prepare(`DELETE FROM recommendations WHERE key=?`).run(s.key);
  })();

  const res: AgentResult = {
    en: `${cands.length} item(s) below reorder point: ${funded} funded (${fmt(newCost)} OMR), ${deferred} deferred. ` +
      `Budget left after drafts: ${fmt(remaining)} of ${fmt(startRemaining)} OMR free. ${skipped.length} overstocked item(s) never reordered.`,
    ar: `${cands.length} صنف دون نقطة إعادة الطلب: ${funded} ممول (${fmt(newCost)} ر.ع) و${deferred} مؤجل. ` +
      `المتبقي من الميزانية بعد المسودات: ${fmt(remaining)} من ${fmt(startRemaining)} ر.ع. ${skipped.length} صنف مخزونه زائد لن يُعاد طلبه.`,
  };
  logRun(group, "replenishment", started, res.en, res.ar);
  return res;
}
