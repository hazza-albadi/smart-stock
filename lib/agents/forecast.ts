import { db } from "../db";
import { addDays } from "../time";
import { seasonFactor, type SeasonCfg } from "../calc";
import { getItems, getSim, logRun, M, type AgentResult } from "../core";
import { loadSettings } from "../settings";
import { loadLive } from "../live";

/** Total OUT (excluding expiry write-offs) in [from, to]. */
function outBetween(itemId: string, from: string, to: string): number {
  return (db().prepare(
    `SELECT COALESCE(SUM(quantity),0) q FROM stock_movements WHERE item_id=? AND movement_type='OUT' AND reference!='EXPIRED' AND date BETWEEN ? AND ?`,
  ).get(itemId, from, to) as { q: number }).q;
}

/** Agent 1 (READ): weekly usage, seasonal forecast, demand anomaly. Stock-dependent figures (cover, stock-out) are always computed live. */
export function forecastAgent(group: string, trigger: string): AgentResult {
  const started = new Date().toISOString();
  const cfg = loadSettings();
  const sim = getSim();
  const dataEnd = sim.data_end; // last complete day of movement data
  const origin = sim.sim_date;
  const season = cfg.j<SeasonCfg>("demand.season");
  const horizon = cfg.n("forecast.horizon_weeks"), recent = cfg.n("forecast.recent_weeks"), prior = cfg.n("forecast.prior_weeks");
  const window = horizon * 7;
  const items = getItems();
  const d = db();
  const rows: unknown[][] = [];
  const anomalies: string[] = [];

  for (const it of items) {
    const w4 = outBetween(it.item_id, addDays(dataEnd, -(window - 1)), dataEnd) / horizon;
    const lastR = outBetween(it.item_id, addDays(dataEnd, -(recent * 7 - 1)), dataEnd) / recent;
    const priorAvg = outBetween(it.item_id, addDays(dataEnd, -((prior + recent) * 7 - 1)), addDays(dataEnd, -recent * 7)) / prior;
    const ratio = priorAvg > 0 ? lastR / priorAvg : 0;
    const anomaly = lastR >= cfg.n("forecast.anomaly_min_units") && priorAvg > 0 && lastR > cfg.n("forecast.anomaly_ratio") * priorAvg ? 1 : 0;

    // De-seasonalise recent usage, then re-apply the seasonal index for each forecast week.
    let sLast = 0;
    for (let i = 0; i < window; i++) sLast += seasonFactor(season, it.item_id, addDays(dataEnd, -i));
    sLast /= window;
    const baseWeekly = w4 / (sLast || 1);
    const weeks: number[] = [];
    for (let k = 0; k < horizon; k++) {
      let s = 0;
      for (let i = 0; i < 7; i++) s += (baseWeekly / 7) * seasonFactor(season, it.item_id, addDays(origin, k * 7 + i));
      weeks.push(Math.round(s * 10) / 10);
    }
    const f4 = weeks.reduce((a, b) => a + b, 0);
    const seasonAvg = baseWeekly > 0 ? f4 / horizon / baseWeekly : 1;
    if (anomaly) anomalies.push(`${it.item_id} ×${ratio.toFixed(1)}`);
    rows.push([it.item_id, w4, baseWeekly, priorAvg, lastR, anomaly, ratio, seasonAvg, JSON.stringify(weeks), f4, weeks[0] / 7, sim.tick]);
  }

  d.transaction(() => {
    d.prepare(`DELETE FROM forecasts`).run();
    const st = d.prepare(`INSERT INTO forecasts(item_id,weekly_usage,base_weekly,prior12_avg,last3_avg,anomaly,anomaly_ratio,season_factor,
      forecast_weeks,forecast_4w,daily_forecast,updated_tick) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const r of rows) st.run(...r);
  })();

  const live = loadLive(cfg, { date: sim.sim_date, hour: sim.hour });
  const extra = cfg.n("alerts.stockout_window_extra_days");
  let atRisk = 0;
  for (const l of live.values()) if (l.stockout && l.stockout.days <= l.item.lead_time_days + extra) atRisk++;

  const res: AgentResult = { msg: M("run.forecast", { n: items.length, anomalies: anomalies.length ? anomalies.join(", ") : "", atRisk, weeks: horizon, extra }) };
  logRun(group, "forecast", trigger, started, res.msg);
  return res;
}
