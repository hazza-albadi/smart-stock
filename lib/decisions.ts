import { db } from "./db";
import { addDays } from "./time";
import { getSim, logEvent, fmt, type Item, uAr } from "./core";
import { runAll } from "./agents/coordinator";

/** Human in the loop: the AI only proposes. Approve / Reject is stored on the recommendation and logged. */
export async function decide(id: number, decision: "APPROVED" | "REJECTED") {
  const d = db();
  const rec = d.prepare(`SELECT * FROM recommendations WHERE id=?`).get(id) as
    { id: number; key: string; kind: string; item_id: string | null; request_id: string | null; payload: string; status: string } | undefined;
  if (!rec) throw new Error("recommendation not found");
  if (rec.status !== "PENDING") return rec;
  const sim = getSim();
  const p = JSON.parse(rec.payload);
  const ok = decision === "APPROVED";
  if (ok && rec.kind === "SPACE") {
    // refuse if another approval already took the area this proposal relied on
    for (const a of (p.allocations ?? []) as { zone_id: string; area: number }[]) {
      const z = d.prepare(`SELECT rentable - allocated AS r FROM zone_space WHERE zone_id=?`).get(a.zone_id) as { r: number } | undefined;
      if (!z || z.r + 1e-6 < a.area) throw new Error(`Space in ${a.zone_id} is no longer available`);
    }
  }

  d.transaction(() => {
    d.prepare(`UPDATE recommendations SET status=?, decided_at=?, decided_sim_date=? WHERE id=?`)
      .run(decision, new Date().toISOString(), sim.sim_date, id);

    if (rec.kind === "PO") {
      const it = d.prepare(`SELECT * FROM items WHERE item_id=?`).get(rec.item_id) as Item;
      if (ok) {
        let poId = `PO-${it.item_id.slice(4)}-${sim.sim_date.slice(2).replace(/-/g, "")}`;
        let n = 1;
        while (d.prepare(`SELECT 1 FROM purchase_orders_open WHERE po_id=?`).get(poId)) poId = `PO-${it.item_id.slice(4)}-${sim.sim_date.slice(2).replace(/-/g, "")}-${++n}`;
        d.prepare(`INSERT INTO purchase_orders_open VALUES(?,?,?,?,?,?,'OPEN','AGENT',NULL)`)
          .run(poId, it.item_id, it.supplier_id, p.qty, sim.sim_date, addDays(sim.sim_date, it.lead_time_days));
        logEvent("PO_APPROVED", it.item_id, `تمت الموافقة على أمر الشراء ${poId}: ${fmt(p.qty)} ${uAr(it.unit)} من ${it.name_ar} (${fmt(p.cost)} ر.ع) — الوصول ${addDays(sim.sim_date, it.lead_time_days)}`,
          `PO ${poId} approved: ${fmt(p.qty)} ${it.unit} of ${it.name_en} (${fmt(p.cost)} OMR) – arrives ${addDays(sim.sim_date, it.lead_time_days)}`, "info");
      } else {
        logEvent("PO_REJECTED", it.item_id, `تم رفض مسودة أمر الشراء لـ ${it.name_ar}`, `PO draft for ${it.name_en} rejected`, "info");
      }
    } else if (rec.kind === "SUPPLIER_MSG") {
      logEvent("MSG", rec.item_id, ok ? `تمت الموافقة على رسالة المورّد (${p.supplier_name}) — جاهزة للإرسال` : `تم رفض مسودة رسالة المورّد (${p.supplier_name})`,
        ok ? `Supplier message to ${p.supplier_name} approved – ready to send` : `Supplier message to ${p.supplier_name} rejected`, "info");
    } else if (rec.kind === "SPACE") {
      const verb = { APPROVE: ["قبول", "accept"], PARTIAL: ["عرض جزئي", "partial offer"], REJECT: ["رفض", "decline"] }[p.decision as string] ?? ["", ""];
      logEvent("SPACE", null, ok ? `تمت الموافقة على قرار المساحة لطلب ${rec.request_id} (${p.company}): ${verb[0]}` : `تم رفض مقترح المساحة لطلب ${rec.request_id}`,
        ok ? `Space decision for ${rec.request_id} (${p.company}) approved: ${verb[1]}` : `Space proposal for ${rec.request_id} rejected`, "info");
    }
  })();

  await runAll({ useLlm: false, group: `${sim.sim_date}#decision` });
  return { ...rec, status: decision };
}
