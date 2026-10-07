import { db } from "../db";
import { addDays, diffDays } from "../time";
import { polish } from "../llm";
import { getItems, getSim, logRun, logEvent, upsertRec, fmt, type AgentResult, type ForecastRow, type Item, type Lot, type Po, type Severity, uAr} from "../core";

// Business knowledge: a temporary substitute the plant can run on while the preferred input is short.
const ALTERNATIVES: Record<string, string> = { "SKU-002": "SKU-001", "SKU-003": "SKU-004" };
const SEV_ORDER: Severity[] = ["Critical", "High", "Monitor", "Info"];
export const OVERSTOCK_WEEKS = 20;

interface A {
  key: string; kind: string; item_id: string | null; severity: Severity; title_en: string; title_ar: string;
  detail_en: string; detail_ar: string; rec_key?: string;
}

/** Agent 4 (ACT): raises alerts and drafts supplier messages for critical/high supplier issues. */
export async function alertAgent(group: string, useLlm: boolean): Promise<AgentResult> {
  const started = new Date().toISOString();
  const d = db();
  const today = getSim().sim_date;
  const items = getItems();
  const byId = new Map(items.map((i) => [i.item_id, i]));
  const fc = new Map((d.prepare(`SELECT * FROM forecasts`).all() as ForecastRow[]).map((f) => [f.item_id, f]));
  const pos = d.prepare(`SELECT * FROM purchase_orders_open`).all() as Po[];
  const open = pos.filter((p) => p.status === "OPEN" || p.status === "DELAYED_BY_SUPPLIER");
  const sup = new Map((d.prepare(`SELECT * FROM suppliers`).all() as { supplier_id: string; supplier_name: string }[]).map((s) => [s.supplier_id, s.supplier_name]));
  const alerts: A[] = [];
  const msgs: { key: string; item: Item; payload: Record<string, unknown>; en: string; ar: string }[] = [];

  const nm = (i: Item) => `${i.name_en} (${i.item_id})`;
  const nmAr = (i: Item) => `${i.name_ar} (${i.item_id})`;

  for (const it of items) {
    const f = fc.get(it.item_id);
    if (!f) continue;
    const itemPos = open.filter((p) => p.item_id === it.item_id);
    const delayed = itemPos.filter((p) => p.status === "DELAYED_BY_SUPPLIER");
    const alt = ALTERNATIVES[it.item_id] ? byId.get(ALTERNATIVES[it.item_id]) : undefined;

    // --- stock-out risk (current or forecast) ---
    let stockoutSev: Severity | null = null;
    const expiryDriven = f.usable_qty < f.on_hand - 1; // the shortfall is caused by a lot expiring: covered by the expiry alert
    if (f.on_hand <= 0) stockoutSev = "Critical";
    else if (!expiryDriven && f.days_to_stockout !== null && f.days_to_stockout <= it.lead_time_days + 7) {
      const imminent = f.days_to_stockout <= 7;
      stockoutSev = it.criticality === "A" ? (imminent ? "Critical" : "High") : it.criticality === "B" ? (imminent ? "High" : "Monitor") : "Monitor";
    }
    if (stockoutSev) {
      const dts = f.on_hand <= 0 ? 0 : (f.days_to_stockout as number);
      const seasonal = f.season_factor > 1.05;
      alerts.push({
        key: `STOCKOUT:${it.item_id}`, kind: "STOCKOUT", item_id: it.item_id, severity: stockoutSev,
        title_en: f.on_hand <= 0 ? `Stockout – production stopped: ${nm(it)}` : `Stock-out risk in ${dts} day(s): ${nm(it)}`,
        title_ar: f.on_hand <= 0 ? `نفاد المخزون — توقف الإنتاج: ${nmAr(it)}` : `خطر نفاد خلال ${dts} يوم: ${nmAr(it)}`,
        detail_en: `On hand ${fmt(f.on_hand)} ${it.unit} = ${f.weeks_cover.toFixed(1)} weeks of cover (safety stock ${fmt(it.safety_stock)}, lead time ${it.lead_time_days}d, criticality ${it.criticality}).` +
          `${seasonal ? ` Forecast includes the Oct–Mar season (x${f.season_factor.toFixed(2)}).` : ""}` +
          `${delayed.length ? ` Open PO ${delayed[0].po_id} is delayed to ${delayed[0].expected_arrival}.` : itemPos.length ? ` Next PO arrives ${itemPos.map((p) => p.expected_arrival).sort()[0]}.` : " No open PO."}`,
        detail_ar: `المتوفر ${fmt(f.on_hand)} ${uAr(it.unit)} = ${f.weeks_cover.toFixed(1)} أسبوع تغطية (مخزون الأمان ${fmt(it.safety_stock)}، مدة التوريد ${it.lead_time_days} يوم، الأهمية ${it.criticality}).` +
          `${seasonal ? ` يتضمن التوقع موسم أكتوبر–مارس (×${f.season_factor.toFixed(2)}).` : ""}` +
          `${delayed.length ? ` أمر الشراء ${delayed[0].po_id} متأخر حتى ${delayed[0].expected_arrival}.` : itemPos.length ? ` يصل أمر الشراء القادم ${itemPos.map((p) => p.expected_arrival).sort()[0]}.` : " لا يوجد أمر شراء مفتوح."}`,
        rec_key: !delayed.length && (stockoutSev === "Critical" || stockoutSev === "High") ? `MSG:STOCKOUT:${it.item_id}` : undefined,
      });
      if (!delayed.length && (stockoutSev === "Critical" || stockoutSev === "High")) {
        const sName = sup.get(it.supplier_id) ?? it.supplier_id;
        msgs.push({
          key: `MSG:STOCKOUT:${it.item_id}`, item: it, payload: { item_id: it.item_id, supplier_id: it.supplier_id, supplier_name: sName, alert: "STOCKOUT" },
          en: `Subject: Urgent supply request – ${it.name_en} (${it.item_id})\n\nDear ${sName} team,\n\nOur stock of ${it.name_en} is ${fmt(f.on_hand)} ${it.unit} (about ${f.weeks_cover.toFixed(1)} weeks of cover) and demand is rising with the season. ` +
            `Please confirm the earliest delivery date and the quantity you can supply within ${it.lead_time_days} days, ideally with expedited shipping.\n\nBest regards,\nQeshour Procurement`,
          ar: `الموضوع: طلب توريد عاجل — ${it.name_ar} (${it.item_id})\n\nالسادة فريق ${sName} المحترمين،\n\nمخزوننا من ${it.name_ar} هو ${fmt(f.on_hand)} ${uAr(it.unit)} (حوالي ${f.weeks_cover.toFixed(1)} أسبوع تغطية) والطلب في ازدياد مع الموسم. ` +
            `نرجو تأكيد أقرب موعد تسليم والكمية التي يمكنكم توريدها خلال ${it.lead_time_days} أيام، ويفضّل بشحن مستعجل.\n\nمع التحية،\nمشتريات قشور`,
        });
      }
    }

    // --- delayed PO ---
    for (const p of delayed) {
      const sev: Severity = stockoutSev === "Critical" || f.on_hand <= it.safety_stock ? "Critical" : "High";
      const dueOrig = addDays(p.order_date, it.lead_time_days);
      const gap = Math.max(0, diffDays(p.expected_arrival, today));
      const sName = sup.get(p.supplier_id) ?? p.supplier_id;
      const days = f.days_to_stockout ?? 0;
      alerts.push({
        key: `DELAY:${p.po_id}`, kind: "DELAYED_PO", item_id: it.item_id, severity: sev,
        title_en: `Delayed PO ${p.po_id}: ${nm(it)} now arrives ${p.expected_arrival}`,
        title_ar: `تأخّر أمر الشراء ${p.po_id}: ${nmAr(it)} سيصل ${p.expected_arrival}`,
        detail_en: `Ordered ${p.order_date} (due about ${dueOrig}); supplier delay means ${gap} more day(s) without it. Stock lasts ${f.weeks_cover.toFixed(1)} weeks.` +
          `${alt ? ` Temporary alternative: ${alt.name_en} (${alt.item_id}) – ${fmt(fc.get(alt.item_id)?.on_hand ?? 0)} ${alt.unit} on hand.` : ""}`,
        detail_ar: `تم الطلب ${p.order_date} (الاستحقاق نحو ${dueOrig}); تأخر المورّد يعني ${gap} يوماً إضافياً دون هذا الصنف. المخزون يكفي ${f.weeks_cover.toFixed(1)} أسبوع.` +
          `${alt ? ` بديل مؤقت: ${alt.name_ar} (${alt.item_id}) – المتوفر ${fmt(fc.get(alt.item_id)?.on_hand ?? 0)} ${uAr(alt.unit)}.` : ""}`,
        rec_key: `MSG:${p.po_id}`,
      });
      msgs.push({
        key: `MSG:${p.po_id}`, item: it, payload: { item_id: it.item_id, supplier_id: p.supplier_id, supplier_name: sName, po_id: p.po_id, alternative: alt?.item_id ?? null },
        en: `Subject: Urgent follow-up – delayed PO ${p.po_id} (${it.name_en})\n\nDear ${sName} team,\n\nOur order ${p.po_id} for ${fmt(p.quantity)} ${it.unit} of ${it.name_en}, placed on ${p.order_date}, is now shown as delayed to ${p.expected_arrival}. ` +
          `Our current stock is only ${fmt(f.on_hand)} ${it.unit} (about ${f.weeks_cover.toFixed(1)} weeks of cover)${days ? ` and production would stop in about ${days} day(s)` : ""}.\n\n` +
          `Please (1) confirm a firm delivery date, and (2) ship a partial delivery of the first available quantity immediately.` +
          `${alt ? `\n\nAs a temporary alternative we can also take ${alt.name_en} (${alt.item_id}); please quote availability and lead time.` : ""}\n\nBest regards,\nQeshour Procurement`,
        ar: `الموضوع: متابعة عاجلة — تأخّر أمر الشراء ${p.po_id} (${it.name_ar})\n\nالسادة فريق ${sName} المحترمين،\n\nأمر الشراء ${p.po_id} بكمية ${fmt(p.quantity)} ${uAr(it.unit)} من ${it.name_ar} المُقدَّم بتاريخ ${p.order_date} ظهر الآن متأخراً حتى ${p.expected_arrival}. ` +
          `مخزوننا الحالي ${fmt(f.on_hand)} ${uAr(it.unit)} فقط (حوالي ${f.weeks_cover.toFixed(1)} أسبوع تغطية)${days ? ` وسيتوقف الإنتاج خلال نحو ${days} يوم` : ""}.\n\n` +
          `نرجو (1) تأكيد موعد تسليم نهائي، و(2) شحن دفعة جزئية من الكمية المتاحة فوراً.` +
          `${alt ? `\n\nوكبديل مؤقت يمكننا استلام ${alt.name_ar} (${alt.item_id})؛ نرجو إفادتنا بالتوفر ومدة التوريد.` : ""}\n\nمع التحية،\nمشتريات قشور`,
      });
    }

    // --- demand anomaly ---
    if (f.anomaly) {
      alerts.push({
        key: `ANOMALY:${it.item_id}`, kind: "ANOMALY", item_id: it.item_id, severity: "High",
        title_en: `Demand anomaly x${f.anomaly_ratio.toFixed(1)}: ${nm(it)}`, title_ar: `شذوذ في الطلب ×${f.anomaly_ratio.toFixed(1)}: ${nmAr(it)}`,
        detail_en: `Last 3 weeks average ${f.last3_avg.toFixed(0)}/wk vs ${f.prior12_avg.toFixed(0)}/wk over the prior 12 weeks. Only ${fmt(f.on_hand)} ${it.unit} on hand${itemPos.length ? `; ${fmt(itemPos.reduce((a, p) => a + p.quantity, 0))} ${it.unit} on order` : ""}.`,
        detail_ar: `متوسط آخر 3 أسابيع ${f.last3_avg.toFixed(0)}/أسبوع مقابل ${f.prior12_avg.toFixed(0)}/أسبوع للـ 12 أسبوعاً السابقة. المتوفر ${fmt(f.on_hand)} ${uAr(it.unit)} فقط${itemPos.length ? `؛ و${fmt(itemPos.reduce((a, p) => a + p.quantity, 0))} ${uAr(it.unit)} قيد الطلب` : ""}.`,
      });
    }

    // --- overstock ---
    if (f.weeks_cover > OVERSTOCK_WEEKS) {
      alerts.push({
        key: `OVERSTOCK:${it.item_id}`, kind: "OVERSTOCK", item_id: it.item_id, severity: "Info",
        title_en: `Overstock (${f.weeks_cover > 99 ? ">99" : f.weeks_cover.toFixed(0)} weeks): ${nm(it)}`, title_ar: `مخزون زائد (${f.weeks_cover > 99 ? ">99" : f.weeks_cover.toFixed(0)} أسبوع): ${nmAr(it)}`,
        detail_en: `${fmt(f.on_hand)} ${it.unit} on hand (${fmt(f.on_hand * it.unit_cost_omr)} OMR tied up). Never reordered; consider pausing purchases.`,
        detail_ar: `المتوفر ${fmt(f.on_hand)} ${uAr(it.unit)} (${fmt(f.on_hand * it.unit_cost_omr)} ر.ع مجمّدة). لن يُعاد طلبه؛ يُنصح بإيقاف الشراء.`,
      });
    }

    // --- expiry within 14 days ---
    const lots = d.prepare(`SELECT * FROM current_stock WHERE item_id=? AND quantity_on_hand>0 AND expiry_date IS NOT NULL`).all(it.item_id) as Lot[];
    for (const l of lots) {
      const days = diffDays(l.expiry_date as string, today);
      if (days > 14 || days < 0) continue;
      const daily = f.daily_forecast;
      const atRisk = Math.max(0, l.quantity_on_hand - daily * (days + 1));
      alerts.push({
        key: `EXPIRY:${l.lot_id}`, kind: "EXPIRY", item_id: it.item_id, severity: days <= 7 ? "High" : "Monitor",
        title_en: `Expiring in ${days} day(s): ${nm(it)} lot ${l.lot_id}`, title_ar: `ينتهي خلال ${days} يوم: ${nmAr(it)} الدفعة ${l.lot_id}`,
        detail_en: `${fmt(l.quantity_on_hand)} ${it.unit} expire on ${l.expiry_date}. At current usage about ${fmt(atRisk)} ${it.unit} (${fmt(atRisk * it.unit_cost_omr)} OMR) will be written off unless used, sold or redirected.`,
        detail_ar: `${fmt(l.quantity_on_hand)} ${uAr(it.unit)} تنتهي صلاحيتها في ${l.expiry_date}. بمعدل الاستهلاك الحالي سيُشطب نحو ${fmt(atRisk)} ${uAr(it.unit)} (${fmt(atRisk * it.unit_cost_omr)} ر.ع) ما لم تُستخدم أو تُباع أو يُعاد توجيهها.`,
      });
    }

    // --- safety items low ---
    if (it.category === "Safety gear" && f.on_hand < it.safety_stock) {
      alerts.push({
        key: `SAFETY:${it.item_id}`, kind: "SAFETY_LOW", item_id: it.item_id, severity: f.on_hand <= 0 ? "Critical" : "High",
        title_en: `Safety item below safety stock: ${nm(it)}`, title_ar: `معدات سلامة دون مخزون الأمان: ${nmAr(it)}`,
        detail_en: `${fmt(f.on_hand)} ${it.unit} on hand vs safety stock ${fmt(it.safety_stock)}. Operating without safety gear is a compliance risk.`,
        detail_ar: `المتوفر ${fmt(f.on_hand)} ${uAr(it.unit)} مقابل مخزون الأمان ${fmt(it.safety_stock)}. التشغيل دون معدات السلامة مخاطرة امتثال.`,
        rec_key: `MSG:SAFETY:${it.item_id}`,
      });
      const sName = sup.get(it.supplier_id) ?? it.supplier_id;
      msgs.push({
        key: `MSG:SAFETY:${it.item_id}`, item: it, payload: { item_id: it.item_id, supplier_id: it.supplier_id, supplier_name: sName, alert: "SAFETY_LOW" },
        en: `Subject: Priority order – ${it.name_en}\n\nDear ${sName} team,\n\nOur stock of ${it.name_en} (${it.item_id}) is ${fmt(f.on_hand)} ${it.unit}, below our safety level of ${fmt(it.safety_stock)}. Please prioritise our next order and confirm the delivery date.\n\nBest regards,\nQeshour Procurement`,
        ar: `الموضوع: طلب ذو أولوية — ${it.name_ar}\n\nالسادة فريق ${sName} المحترمين،\n\nمخزوننا من ${it.name_ar} (${it.item_id}) هو ${fmt(f.on_hand)} ${uAr(it.unit)}، أقل من مستوى الأمان ${fmt(it.safety_stock)}. نرجو إعطاء أولوية لطلبنا القادم وتأكيد موعد التسليم.\n\nمع التحية،\nمشتريات قشور`,
      });
    }
  }

  // --- zone over capacity (stock + fixed area exceeds the zone) ---
  const zs = d.prepare(`SELECT z.zone_id, z.over_capacity, w.zone_name FROM zone_space z JOIN warehouse_zones w ON w.zone_id=z.zone_id WHERE z.over_capacity>1`).all() as
    { zone_id: string; over_capacity: number; zone_name: string }[];
  for (const z of zs) {
    alerts.push({
      key: `SPACE_OVER:${z.zone_id}`, kind: "SPACE_OVER", item_id: null, severity: "High",
      title_en: `Zone ${z.zone_id} is ${fmt(z.over_capacity)} m² over capacity`, title_ar: `المنطقة ${z.zone_id} تتجاوز السعة بمقدار ${fmt(z.over_capacity)} م²`,
      detail_en: `Stock held in ${z.zone_name} needs more area than the zone has (incoming purchase orders). Rentable space there is 0; consider redirecting receipts to overflow zone Z5 or pausing orders.`,
      detail_ar: `المخزون في ${z.zone_name} يحتاج مساحة أكبر مما تملكه المنطقة (بسبب أوامر الشراء الواردة). المساحة القابلة للتأجير هناك صفر؛ يُنصح بتحويل الاستلام إلى منطقة الفائض Z5 أو إيقاف الطلبات.`,
    });
  }

  // ---- persist alerts (new ones also become events) ----
  const existing = new Map((d.prepare(`SELECT key, severity, active FROM alerts`).all() as { key: string; severity: string; active: number }[]).map((r) => [r.key, r]));
  const seen = new Set<string>();
  let newCount = 0;
  for (const a of alerts) {
    seen.add(a.key);
    const ex = existing.get(a.key);
    if (!ex) {
      d.prepare(`INSERT INTO alerts(key,kind,item_id,severity,title_en,title_ar,detail_en,detail_ar,rec_key,active,first_sim_date,updated_sim_date)
        VALUES(?,?,?,?,?,?,?,?,?,1,?,?)`).run(a.key, a.kind, a.item_id, a.severity, a.title_en, a.title_ar, a.detail_en, a.detail_ar, a.rec_key ?? null, today, today);
      newCount++;
      if (a.severity !== "Info") logEvent("ALERT", a.item_id, a.title_ar, a.title_en, a.severity === "Critical" ? "critical" : a.severity === "High" ? "high" : "info");
    } else {
      d.prepare(`UPDATE alerts SET severity=?,title_en=?,title_ar=?,detail_en=?,detail_ar=?,rec_key=?,active=1,updated_sim_date=? WHERE key=?`)
        .run(a.severity, a.title_en, a.title_ar, a.detail_en, a.detail_ar, a.rec_key ?? null, today, a.key);
      if (!ex.active || (ex.severity !== a.severity && SEV_ORDER.indexOf(a.severity) < SEV_ORDER.indexOf(ex.severity as Severity))) {
        if (a.severity === "Critical" || a.severity === "High") logEvent("ALERT", a.item_id, a.title_ar, a.title_en, a.severity === "Critical" ? "critical" : "high");
      }
    }
  }
  for (const [key, r] of existing) if (!seen.has(key) && r.active) d.prepare(`UPDATE alerts SET active=0,updated_sim_date=? WHERE key=?`).run(today, key);

  // ---- supplier message drafts (only for critical/high issues) ----
  const keepMsg = new Set<string>();
  for (const m of msgs) {
    const sev = alerts.find((a) => a.rec_key === m.key)?.severity;
    if (sev !== "Critical" && sev !== "High") continue;
    const text = useLlm ? await polish(m.en, m.ar) : { en: m.en, ar: m.ar };
    const status = upsertRec(m.key, "SUPPLIER_MSG", m.item.item_id, null, { ...m.payload, body_en: text.en, body_ar: text.ar });
    if (status === "PENDING") keepMsg.add(m.key);
  }
  for (const r of d.prepare(`SELECT key FROM recommendations WHERE kind='SUPPLIER_MSG' AND status='PENDING'`).all() as { key: string }[]) {
    if (!keepMsg.has(r.key)) d.prepare(`DELETE FROM recommendations WHERE key=?`).run(r.key);
  }

  const count = (s: Severity) => alerts.filter((a) => a.severity === s).length;
  const res: AgentResult = {
    en: `${alerts.length} active alert(s): ${count("Critical")} critical, ${count("High")} high, ${count("Monitor")} monitor, ${count("Info")} info (${newCount} new). ${keepMsg.size} supplier message draft(s) awaiting approval.`,
    ar: `${alerts.length} تنبيه نشط: ${count("Critical")} حرج، ${count("High")} مرتفع، ${count("Monitor")} متابعة، ${count("Info")} معلومة (${newCount} جديد). ${keepMsg.size} مسودة رسالة للمورّدين بانتظار الموافقة.`,
  };
  logRun(group, "alerts", started, res.en, res.ar);
  return res;
}
