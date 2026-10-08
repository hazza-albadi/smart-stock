import { db } from "../db";
import { addDays, diffDays } from "../time";
import { getSim, logRun, logEvent, upsertRec, M, type AgentResult, type Item, type Msg, type Severity } from "../core";
import { loadSettings } from "../settings";
import { loadLive } from "../live";
import { coverHours } from "../calc";
import { computeZones } from "../zones";

const SEV_ORDER: Severity[] = ["Critical", "High", "Monitor", "Info"];
const EVENT_SEV = { Critical: "critical", High: "high", Monitor: "info", Info: "info" } as const;

interface A {
  key: string; kind: string; item_id: string | null; severity: Severity; title: Msg; detail: Msg[]; ignore: Msg | null; rec_key?: string; flow?: "purchasing" | "both";
}
/** Only genuinely critical situations pause the simulation: expiry inside 24 h and a delayed critical PO (a real stock-out is logged by the engine). */
const PAUSE_KINDS = ["EXPIRY", "DELAYED_PO"];
const evSeverity = (a: { kind: string; severity: Severity }) => (a.kind === "DECISION_OVERDUE" ? "high" : EVENT_SEV[a.severity]);
const evOpts = (a: { key: string; kind: string; severity: Severity; flow?: "purchasing" | "both" }) => ({ ref: a.key, flow: a.flow, meta: { pause: a.severity === "Critical" && PAUSE_KINDS.includes(a.kind) } });
const lastsH = (l: { onHand: number; weeklyUsage: number }) => coverHours(l.onHand, l.weeklyUsage);
const hrs = (h: number) => Math.max(0, Math.round(h));

/** Agent 4 (ACT): raises alerts (what / why / what happens if ignored) and drafts supplier messages for critical/high supplier issues. */
export function alertAgent(group: string, trigger: string): AgentResult {
  const started = new Date().toISOString();
  const d = db();
  const cfg = loadSettings();
  const sim = getSim();
  const now = { date: sim.sim_date, hour: sim.hour };
  const live = loadLive(cfg, now);
  const sup = new Map((d.prepare(`SELECT * FROM suppliers`).all() as { supplier_id: string; supplier_name: string }[]).map((s) => [s.supplier_id, s.supplier_name]));
  const alts = cfg.j<Record<string, string>>("alerts.alternatives");
  const extra = cfg.n("alerts.stockout_window_extra_days"), imminent = cfg.n("alerts.stockout_imminent_days");
  const classes = [...new Set([...live.values()].map((l) => l.item.criticality))].sort();
  const alerts: A[] = [];
  const msgs: { key: string; item: Item; payload: Record<string, unknown> }[] = [];

  for (const l of live.values()) {
    const it = l.item;
    const f = l.fc;
    if (!f) continue;
    const delayed = l.pos.filter((p) => p.status === "DELAYED_BY_SUPPLIER");
    const alt = alts[it.item_id] ? live.get(alts[it.item_id]) : undefined;
    const so = l.stockout;
    const stockoutHours = l.onHand <= 0 ? 0 : so ? hrs(so.hours) : null;

    // --- stock-out risk (current or forecast) ---
    let sev: Severity | null = null;
    const expiryDriven = l.usable < l.onHand - 1; // shortfall caused by a lot expiring: covered by the expiry alert
    if (l.onHand <= 0) sev = "Critical";
    else if (!expiryDriven && so && so.days <= it.lead_time_days + extra) {
      const soon = so.days <= imminent;
      const rank = classes.indexOf(it.criticality); // 0 = most essential class
      sev = rank === 0 ? (soon ? "Critical" : "High") : rank === 1 ? (soon ? "High" : "Monitor") : "Monitor";
    }
    if (sev) {
      const detail: Msg[] = [M("alert.stockout.d1", { onhand: l.onHand, unit: it.unit, cover: l.cover, lasts: lastsH(l), ss: it.safety_stock, lead: it.lead_time_days, crit: it.criticality })];
      if (f.season_factor > 1.05) detail.push(M("alert.stockout.season", { factor: f.season_factor }));
      if (delayed.length) detail.push(M("alert.stockout.delayed", { po: delayed[0].po_id, date: delayed[0].expected_arrival, hour: delayed[0].expected_hour }));
      else if (l.pos.length) detail.push(M("alert.stockout.next_po", { date: l.pos[0].expected_arrival, hour: l.pos[0].expected_hour }));
      else detail.push(M("alert.stockout.no_po"));
      const draft = !delayed.length && (sev === "Critical" || sev === "High");
      alerts.push({
        key: `STOCKOUT:${it.item_id}`, kind: "STOCKOUT", item_id: it.item_id, severity: sev,
        title: l.onHand <= 0 ? M("alert.stockout_now.title", { item: it.item_id }) : M("alert.stockout.title", { hours: stockoutHours, item: it.item_id }),
        detail, ignore: l.onHand <= 0 ? M("alert.ignore.stopped", { item: it.item_id }) : M("alert.ignore.stockout", { hours: stockoutHours, date: so?.date ?? "" }),
        rec_key: draft ? `MSG:STOCKOUT:${it.item_id}` : undefined,
      });
      if (draft) {
        msgs.push({ key: `MSG:STOCKOUT:${it.item_id}`, item: it, payload: {
          kind: "stockout", item_id: it.item_id, supplier_id: it.supplier_id, supplier_name: sup.get(it.supplier_id) ?? it.supplier_id,
          subject: M("sup.stockout.subject", { item: it.item_id }),
          parts: [M("sup.stockout.body", { supplier: sup.get(it.supplier_id) ?? "", item: it.item_id, onhand: l.onHand, unit: it.unit, cover: l.cover, lasts: lastsH(l), lead: it.lead_time_days })],
        } });
      }
    }

    // --- delayed PO ---
    for (const p of delayed) {
      const psev: Severity = sev === "Critical" || l.onHand <= it.safety_stock ? "Critical" : "High";
      const dueOrig = addDays(p.order_date, it.lead_time_days);
      const gap = Math.max(0, diffDays(p.expected_arrival, now.date));
      const sName = sup.get(p.supplier_id) ?? p.supplier_id;
      const altLive = alt?.onHand ?? 0;
      const detail: Msg[] = [M("alert.delay.d1", { po: p.po_id, order_date: p.order_date, due: dueOrig, gap, cover: l.cover, lasts: lastsH(l) })];
      if (alt) detail.push(M("alert.delay.alt", { alt: alt.item.item_id, onhand: altLive, unit: alt.item.unit }));
      alerts.push({
        key: `DELAY:${p.po_id}`, kind: "DELAYED_PO", item_id: it.item_id, severity: psev,
        title: M("alert.delay.title", { po: p.po_id, item: it.item_id, date: p.expected_arrival, hour: p.expected_hour }),
        detail, ignore: so ? M("alert.ignore.delay", { hours: stockoutHours, date: p.expected_arrival }) : M("alert.ignore.delay_ok", { date: p.expected_arrival }),
        rec_key: `MSG:${p.po_id}`,
      });
      const parts: Msg[] = [M("sup.delay.body", {
        supplier: sName, po: p.po_id, qty: p.quantity, unit: it.unit, item: it.item_id, order_date: p.order_date, eta: p.expected_arrival,
        onhand: l.onHand, cover: l.cover, lasts: lastsH(l), hours: stockoutHours ?? 0,
      })];
      if (alt) parts.push(M("sup.delay.alt", { alt: alt.item.item_id }));
      msgs.push({ key: `MSG:${p.po_id}`, item: it, payload: {
        kind: "delay", item_id: it.item_id, supplier_id: p.supplier_id, supplier_name: sName, po_id: p.po_id, alternative: alt?.item.item_id ?? null,
        subject: M("sup.delay.subject", { po: p.po_id, item: it.item_id }), parts,
      } });
    }

    // --- demand anomaly ---
    if (f.anomaly) {
      alerts.push({
        key: `ANOMALY:${it.item_id}`, kind: "ANOMALY", item_id: it.item_id, severity: "High",
        title: M("alert.anomaly.title", { ratio: f.anomaly_ratio, item: it.item_id }),
        detail: [M("alert.anomaly.d1", { last: f.last3_avg, prior: f.prior12_avg, weeks: cfg.n("forecast.recent_weeks"), pweeks: cfg.n("forecast.prior_weeks"), onhand: l.onHand, unit: it.unit }),
          ...(l.pos.length ? [M("alert.anomaly.onorder", { qty: l.pos.reduce((a, p) => a + p.quantity, 0), unit: it.unit })] : [])],
        ignore: so ? M("alert.ignore.stockout", { hours: stockoutHours, date: so.date }) : M("alert.ignore.cover", { cover: l.cover, lasts: lastsH(l) }),
      });
    }

    // --- overstock ---
    if (l.cover > cfg.n("thresholds.overstock_weeks")) {
      alerts.push({
        key: `OVERSTOCK:${it.item_id}`, kind: "OVERSTOCK", item_id: it.item_id, severity: "Info",
        title: M("alert.overstock.title", { cover: l.cover, item: it.item_id }),
        detail: [M("alert.overstock.d1", { onhand: l.onHand, unit: it.unit, value: l.onHand * it.unit_cost_omr })],
        ignore: M("alert.ignore.overstock", { value: l.onHand * it.unit_cost_omr }),
      });
    }

    // --- expiry ---
    for (const lot of l.lots) {
      if (!lot.expiry_date) continue;
      const days = diffDays(lot.expiry_date, now.date);
      if (days > cfg.n("thresholds.expiry_days") || days < 0) continue;
      const hoursLeft = days * 24 + cfg.n("expiry.last_usable_hour") + 1 - now.hour;
      const atRisk = Math.max(0, lot.quantity_on_hand - (f.daily_forecast * hoursLeft) / 24);
      const esev: Severity = hoursLeft < cfg.n("thresholds.expiry_critical_hours") && atRisk > 0 ? "Critical" : days <= cfg.n("thresholds.expiry_high_days") ? "High" : "Monitor";
      alerts.push({
        key: `EXPIRY:${lot.lot_id}`, kind: "EXPIRY", item_id: it.item_id, severity: esev,
        title: M("alert.expiry.title", { days, hours: hoursLeft, item: it.item_id, lot: lot.lot_id }),
        detail: [M("alert.expiry.d1", { qty: lot.quantity_on_hand, unit: it.unit, date: lot.expiry_date, risk: atRisk, value: atRisk * it.unit_cost_omr })],
        ignore: M("alert.ignore.expiry", { qty: atRisk, unit: it.unit, value: atRisk * it.unit_cost_omr, date: lot.expiry_date }),
      });
    }

    // --- safety items low ---
    if (it.category === cfg.s("alerts.safety_category") && l.onHand < it.safety_stock) {
      const sName = sup.get(it.supplier_id) ?? it.supplier_id;
      alerts.push({
        key: `SAFETY:${it.item_id}`, kind: "SAFETY_LOW", item_id: it.item_id, severity: l.onHand <= 0 ? "Critical" : "High",
        title: M("alert.safety.title", { item: it.item_id }),
        detail: [M("alert.safety.d1", { onhand: l.onHand, unit: it.unit, ss: it.safety_stock })],
        ignore: M("alert.ignore.safety", { hours: stockoutHours ?? 0 }),
        rec_key: `MSG:SAFETY:${it.item_id}`,
      });
      msgs.push({ key: `MSG:SAFETY:${it.item_id}`, item: it, payload: {
        kind: "safety", item_id: it.item_id, supplier_id: it.supplier_id, supplier_name: sName,
        subject: M("sup.safety.subject", { item: it.item_id }),
        parts: [M("sup.safety.body", { supplier: sName, item: it.item_id, onhand: l.onHand, unit: it.unit, ss: it.safety_stock })],
      } });
    }
  }

  // --- zone over capacity (safeguard: receiving never lets this happen) ---
  for (const z of computeZones().filter((x) => x.over_capacity > 1)) {
    alerts.push({ key: `SPACE_OVER:${z.zone_id}`, kind: "SPACE_OVER", item_id: null, severity: "High", title: M("alert.space_over.title", { zone: z.zone_id, over: z.over_capacity }),
      detail: [M("alert.space_over.d1")], ignore: null });
  }

  // --- an order draft was cut because tenants hold the space (a signed lease beats a new purchase): shown in BOTH flows ---
  for (const r of d.prepare(`SELECT key, item_id, payload FROM recommendations WHERE kind='PO' AND status='PENDING'`).all() as { key: string; item_id: string; payload: string }[]) {
    const p = JSON.parse(r.payload);
    if (!(p.room?.leased_m2 > 0)) continue;
    alerts.push({
      key: `LEASE_LIMITS_PO:${r.item_id}`, kind: "LEASE_LIMITS_PO", item_id: r.item_id, severity: "High", flow: "both",
      title: M("alert.sp.po_limited.title", { item: r.item_id, qty: p.qty, need: p.room.need, unit: p.unit }),
      detail: [M("alert.sp.po_limited.d1", { leased: p.room.leased_m2, item: r.item_id, qty: p.qty, need: p.room.need, unit: p.unit })],
      ignore: M("alert.sp.po_limited.ignore", { item: r.item_id }),
    });
  }

  // --- recommendations left undecided too long ---
  const escalate = cfg.n("rec.escalate_hours"), escCrit = cfg.n("rec.escalate_critical_hours");
  for (const r of d.prepare(`SELECT key, item_id, payload, created_tick FROM recommendations WHERE kind='PO' AND status='PENDING'`).all() as
    { key: string; item_id: string; payload: string; created_tick: number }[]) {
    const age = sim.tick - r.created_tick;
    if (age < escalate || (JSON.parse(r.payload).snooze_until ?? 0) > sim.tick) continue;
    const l = live.get(r.item_id);
    const p = JSON.parse(r.payload);
    const so = l?.onHand && l.onHand > 0 ? l.stockout : null;
    const critical = l ? l.onHand <= 0 || (so !== null && so.hours < escCrit) : false;
    alerts.push({
      key: `OVERDUE:${r.key}`, kind: "DECISION_OVERDUE", item_id: r.item_id, severity: critical ? "Critical" : "High",
      title: M("alert.overdue.title", { item: r.item_id, hours: age }),
      detail: [M("alert.overdue.d1", { qty: p.qty, unit: p.unit, cost: p.cost })],
      ignore: so ? M("alert.ignore.stockout", { hours: hrs(so.hours), date: so.date }) : M("alert.ignore.stopped", { item: r.item_id }),
    });
  }

  // ---- persist alerts (new / escalated ones also become events) ----
  const existing = new Map((d.prepare(`SELECT key, severity, active FROM alerts WHERE kind NOT IN ('LISTING_RISK','LEASE_OVER')`).all() as { key: string; severity: string; active: number }[]).map((r) => [r.key, r]));
  const seen = new Set<string>();
  let newCount = 0;
  const st = { ins: d.prepare(`INSERT INTO alerts(key,kind,item_id,severity,title,detail,ignore_msg,rec_key,active,first_tick,updated_tick,flow) VALUES(?,?,?,?,?,?,?,?,1,?,?,?)`),
    upd: d.prepare(`UPDATE alerts SET severity=?,title=?,detail=?,ignore_msg=?,rec_key=?,active=1,updated_tick=?,first_tick=CASE WHEN active=0 THEN ? ELSE first_tick END WHERE key=?`) };
  for (const a of alerts) {
    seen.add(a.key);
    const ex = existing.get(a.key);
    const j = [JSON.stringify(a.title), JSON.stringify(a.detail), a.ignore ? JSON.stringify(a.ignore) : null];
    if (!ex) {
      st.ins.run(a.key, a.kind, a.item_id, a.severity, ...j, a.rec_key ?? null, sim.tick, sim.tick, a.flow ?? "purchasing");
      newCount++;
      if (a.severity !== "Info") logEvent("ALERT", a.item_id, a.title, evSeverity(a), evOpts(a));
    } else {
      st.upd.run(a.severity, ...j, a.rec_key ?? null, sim.tick, sim.tick, a.key);
      const rose = SEV_ORDER.indexOf(a.severity) < SEV_ORDER.indexOf(ex.severity as Severity);
      if ((!ex.active || rose) && (a.severity === "Critical" || a.severity === "High")) logEvent("ALERT", a.item_id, a.title, evSeverity(a), evOpts(a));
    }
  }
  for (const [key, r] of existing) if (!seen.has(key) && r.active) d.prepare(`UPDATE alerts SET active=0,updated_tick=? WHERE key=?`).run(sim.tick, key);

  // ---- supplier message drafts (only for critical/high issues; stable key, updated in place) ----
  const keepMsg = new Set<string>();
  for (const m of msgs) {
    const sev = alerts.find((a) => a.rec_key === m.key)?.severity;
    if (sev !== "Critical" && sev !== "High") continue;
    const prev = d.prepare(`SELECT payload FROM recommendations WHERE key=? AND status='PENDING'`).get(m.key) as { payload: string } | undefined;
    const override = prev ? JSON.parse(prev.payload).body_override : undefined; // wording polished by the optional LLM stays
    if (upsertRec(m.key, "SUPPLIER_MSG", m.item.item_id, null, { ...m.payload, body_override: override }) === "PENDING") keepMsg.add(m.key);
  }
  for (const r of d.prepare(`SELECT key FROM recommendations WHERE kind='SUPPLIER_MSG' AND status='PENDING'`).all() as { key: string }[]) {
    if (!keepMsg.has(r.key)) d.prepare(`DELETE FROM recommendations WHERE key=?`).run(r.key);
  }

  const count = (s: Severity) => alerts.filter((a) => a.severity === s).length;
  const res: AgentResult = { msg: M("run.alerts", { total: alerts.length, critical: count("Critical"), high: count("High"), monitor: count("Monitor"), info: count("Info"), fresh: newCount, drafts: keepMsg.size }) };
  logRun(group, "alerts", trigger, started, res.msg);
  return res;
}
