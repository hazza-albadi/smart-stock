import { db } from "../db";
import { addDays, diffDays } from "../time";
import { seasonFactor } from "../seasonality";
import { getItems, getSim, logRun, fmt, type AgentResult, type Lot, type Po } from "../core";

const WINDOW_DAYS = 28;

/** Total OUT (excluding expiry write-offs) in [from, to]. */
function outBetween(itemId: string, from: string, to: string): number {
  return (db().prepare(
    `SELECT COALESCE(SUM(quantity),0) q FROM stock_movements WHERE item_id=? AND movement_type='OUT' AND reference!='EXPIRED' AND date BETWEEN ? AND ?`,
  ).get(itemId, from, to) as { q: number }).q;
}

/** Agent 1 (READ): weekly usage, seasonal forecast for 4 weeks, weeks of cover, demand anomaly, stock-out projection. */
export function forecastAgent(group: string): AgentResult {
  const started = new Date().toISOString();
  const sim = getSim();
  const dataEnd = sim.processed_through; // last day that has movement data
  const origin = sim.sim_date; // forecast starts today
  const items = getItems();
  const d = db();
  const rows: unknown[][] = [];
  const anomalies: string[] = [];
  let atRisk = 0;

  for (const it of items) {
    const w4 = outBetween(it.item_id, addDays(dataEnd, -(WINDOW_DAYS - 1)), dataEnd) / 4;
    const last3 = outBetween(it.item_id, addDays(dataEnd, -20), dataEnd) / 3;
    const prior12 = outBetween(it.item_id, addDays(dataEnd, -104), addDays(dataEnd, -21)) / 12;
    const ratio = prior12 > 0 ? last3 / prior12 : 0;
    const anomaly = last3 >= 5 && prior12 > 0 && last3 > 2 * prior12 ? 1 : 0;

    // De-seasonalise recent usage, then re-apply the seasonal index for each forecast week.
    let sLast = 0;
    for (let i = 0; i < WINDOW_DAYS; i++) sLast += seasonFactor(it.item_id, addDays(dataEnd, -i));
    sLast /= WINDOW_DAYS;
    const baseWeekly = w4 / (sLast || 1);
    const dayDemand = (date: string) => (baseWeekly / 7) * seasonFactor(it.item_id, date);
    const weeks: number[] = [];
    for (let k = 0; k < 4; k++) {
      let s = 0;
      for (let i = 0; i < 7; i++) s += dayDemand(addDays(origin, k * 7 + i));
      weeks.push(Math.round(s * 10) / 10);
    }
    const f4 = weeks.reduce((a, b) => a + b, 0);
    const seasonAvg = baseWeekly > 0 ? f4 / 4 / baseWeekly : 1;

    const lots = d.prepare(`SELECT * FROM current_stock WHERE item_id=? AND quantity_on_hand>0
      ORDER BY expiry_date IS NULL, expiry_date, received_date`).all(it.item_id) as Lot[];
    const onHand = lots.reduce((a, l) => a + l.quantity_on_hand, 0);

    // Usable stock: what FEFO consumption will actually use before each lot expires.
    let usable = 0;
    let consumed = 0;
    for (const l of lots) {
      if (!l.expiry_date) { usable += l.quantity_on_hand; continue; }
      const days = Math.max(0, diffDays(l.expiry_date, origin) + 1);
      let cum = 0;
      for (let i = 0; i < Math.min(days, 400); i++) cum += dayDemand(addDays(origin, i));
      const u = Math.min(l.quantity_on_hand, Math.max(0, cum - consumed));
      usable += u;
      consumed += u;
    }

    // Day-by-day projection including open POs -> projected stock-out date.
    const pos = d.prepare(`SELECT * FROM purchase_orders_open WHERE item_id=? AND status IN ('OPEN','DELAYED_BY_SUPPLIER')`)
      .all(it.item_id) as Po[];
    let stock = usable;
    let stockoutDate: string | null = null;
    let dts: number | null = null;
    for (let i = 0; i < 90; i++) {
      const date = addDays(origin, i);
      for (const p of pos) if (p.expected_arrival === date || (i === 0 && p.expected_arrival < date)) stock += p.quantity;
      stock -= dayDemand(date);
      if (stock <= 0 && baseWeekly > 0) { stockoutDate = date; dts = i; break; }
    }

    const cover = w4 > 0 ? onHand / w4 : 999;
    if (anomaly) anomalies.push(`${it.item_id} ×${ratio.toFixed(1)}`);
    if (dts !== null && dts <= it.lead_time_days + 7) atRisk++;

    rows.push([it.item_id, w4, baseWeekly, prior12, last3, anomaly, ratio, seasonAvg, JSON.stringify(weeks), f4, onHand, usable,
      cover, weeks[0] / 7, stockoutDate, dts, origin]);
  }

  d.transaction(() => {
    d.prepare(`DELETE FROM forecasts`).run();
    const st = d.prepare(`INSERT INTO forecasts(item_id,weekly_usage,base_weekly,prior12_avg,last3_avg,anomaly,anomaly_ratio,season_factor,
      forecast_weeks,forecast_4w,on_hand,usable_qty,weeks_cover,daily_forecast,stockout_date,days_to_stockout,updated_sim_date)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const r of rows) st.run(...r);
  })();

  const res: AgentResult = {
    en: `Forecast ${items.length} items for the next 4 weeks. Demand anomalies: ${anomalies.length ? anomalies.join(", ") : "none"}. ` +
      `${atRisk} item(s) projected to run out within lead time + 1 week.`,
    ar: `تم توقّع ${fmt(items.length)} صنفاً للأسابيع الأربعة القادمة. شذوذ الطلب: ${anomalies.length ? anomalies.join("، ") : "لا يوجد"}. ` +
      `${atRisk} صنف(اً) متوقع نفاده خلال مدة التوريد + أسبوع.`,
  };
  logRun(group, "forecast", started, res.en, res.ar);
  return res;
}
