/**
 * Name: Space Forecast (id: space-forecast)
 * Stage: REASON
 * Role: Looks ahead for windows of space the company will not need, the periods it must keep, and conflicts between rentals and purchasing.
 * Reads: forecasts, items, current_stock, purchase_orders_open, recommendations, warehouse_zones, space_leases, space_listings, space_offers, space_decisions
 * Writes: space_forecasts, alerts, space_offers, events
 * VERIFY: listed area never above its free window; leased area plus the company's own need within the zone capacity (checks.listedAreaViolations, checks.capacityViolations)
 * Runs when: setting schedule.space_plan_hours (and after every decision)
 * Hands over to: the manager: windows, conflicts and alerts wait for a human decision (Space flow)
 */
import { db } from "../db";
import { addDays, diffDays } from "../time";
import { freeWindows, confidenceOf } from "../calc";
import { getSim, logRun, M, type AgentResult, type Msg } from "../core";
import { loadSettings } from "../settings";
import { windowCfg, logSpaceEvent } from "../space/common";
import { projectZones, listableSeries, minOver, rawFree, LISTING_REMAINING, type WindowRow } from "../space/forecast";
import { evaluateOffer, getListing, listingRest, listingAdvice, type Offer } from "../space/market";
import { capacityViolations, listedAreaViolations, vcheck, type VCheck } from "../checks";
import { countRows, type StageMsgs } from "./steps";

/**
 * Conflicts between rental and purchasing become alerts in BOTH flows (flow 'both'): a published listing the company's own approved
 * orders now squeeze, and offers waiting for an answer that the company now needs the space for.
 */
export function syncSpaceConflicts() {
  const d = db();
  const sim = getSim();
  const cfg = loadSettings();
  const seen = new Set<string>();
  const rows = d.prepare(`SELECT * FROM space_forecasts WHERE state='CONFLICT' ORDER BY id`).all() as { zone_id: string; start_date: string; end_date: string; area: number; inputs: string }[];
  const put = (key: string, kind: string, severity: string, title: Msg, detail: Msg[], ignore: Msg | null, poRef: string | null, flow: "both" | "space" = "both") => {
    seen.add(key);
    const ex = d.prepare(`SELECT active FROM alerts WHERE key=?`).get(key) as { active: number } | undefined;
    if (!ex) {
      d.prepare(`INSERT INTO alerts(key,kind,item_id,severity,title,detail,ignore_msg,rec_key,active,first_tick,updated_tick,flow) VALUES(?,?,NULL,?,?,?,?,NULL,1,?,?,?)`)
        .run(key, kind, severity, JSON.stringify(title), JSON.stringify(detail), ignore ? JSON.stringify(ignore) : null, sim.tick, sim.tick, flow);
    } else {
      d.prepare(`UPDATE alerts SET severity=?,title=?,detail=?,ignore_msg=?,active=1,updated_tick=?,first_tick=CASE WHEN active=0 THEN ? ELSE first_tick END WHERE key=?`)
        .run(severity, JSON.stringify(title), JSON.stringify(detail), ignore ? JSON.stringify(ignore) : null, sim.tick, sim.tick, key);
    }
    if (!ex || !ex.active) logSpaceEvent(flow === "both" ? "SPACE_CONFLICT" : "SPACE_ADVICE", title, flow === "both" ? "high" : "info", { flow, ref: key, meta: { po: poRef } });
  };
  for (const r of rows) {
    const inp = JSON.parse(r.inputs) as { listing_id: number; rest: number; ok_area: number; driver: { po_id: string; item_id: string; qty: number; area: number; arrival: string } | null };
    const dr = inp.driver;
    put(`CONFLICT:LISTING:${inp.listing_id}`, "LISTING_RISK", "High",
      M("alert.sp.listing_risk.title", { zone: r.zone_id, short: r.area, listing: inp.rest }),
      [M("alert.sp.listing_risk.d1", { po: dr?.po_id ?? "", item: dr?.item_id ?? "", qty: dr?.qty ?? 0, area: dr?.area ?? 0, arrival: dr?.arrival ?? "", from: r.start_date, to: r.end_date, ok: inp.ok_area, listing: inp.rest })],
      M("alert.sp.listing_risk.ignore", { short: r.area }), dr?.po_id ?? null);
  }
  // a rental has started (or is about to) in a zone where our own stock still fills the space: never cancelled, but flagged in both flows
  for (const z of d.prepare(`SELECT w.zone_id, w.capacity_m2 c, w.fixed_occupied_m2_aisles_equipment f,
      COALESCE((SELECT SUM(x.quantity_on_hand*i.space_m2_per_unit) FROM current_stock x JOIN items i ON i.item_id=x.item_id WHERE x.zone_id=w.zone_id),0) st,
      COALESCE((SELECT SUM(area) FROM space_leases WHERE zone_id=w.zone_id AND status IN ('RESERVED','ACTIVE') AND start_date<=? AND ?<end_date),0) ls FROM warehouse_zones w`).all(sim.sim_date, sim.sim_date) as { zone_id: string; c: number; f: number; st: number; ls: number }[]) {
    if (z.ls > 0 && z.f + z.st + z.ls > z.c + 1e-6)
      put(`LEASE_OVER:${z.zone_id}`, "LEASE_OVER", "High", M("alert.sp.lease_over.title", { zone: z.zone_id, over: z.f + z.st + z.ls - z.c }),
        [M("alert.sp.lease_over.d1", { zone: z.zone_id, leased: z.ls, stock: z.f + z.st, capacity: z.c })], M("alert.sp.lease_over.ignore", { zone: z.zone_id }), null);
  }
  // a listing nobody answered within the window: a suggestion (lower the price, widen dates or area, split)
  for (const a of listingAdvice(cfg))
    put(`NO_OFFERS:${a.listing_id}`, "NO_OFFERS", "Monitor", M("alert.sp.no_offers.title", { zone: a.zone_id, days: cfg.n("space.offer_window_days") }),
      [M(a.high ? "alert.sp.no_offers.d_high" : "alert.sp.no_offers.d1", { price: a.price, market: a.market, suggest: a.suggest_price })], M("alert.sp.no_offers.ignore"), null, "space");
  // offers waiting for an answer: is the space still free? (a purchase approved meanwhile can take it)
  const lstProj = new Map<number, ReturnType<typeof projectZones>>();
  for (const o of d.prepare(`SELECT * FROM space_offers WHERE status='PENDING' ORDER BY id`).all() as Offer[]) {
    const l = getListing(o.listing_id);
    if (!l) continue;
    if (!lstProj.has(l.id)) lstProj.set(l.id, projectZones(cfg, { excludeListing: l.id }));
    const ev = evaluateOffer(cfg, o, l, lstProj.get(l.id));
    // "now needed" only for offers that would otherwise be acceptable (the area fits the listing)
    const bad = o.area <= listingRest(l) + 1e-6 ? ev.checks.find((c) => c.key === "needs" && c.level === "bad") : undefined;
    if (bad && o.flag !== "COMPANY_NEEDS") {
      d.prepare(`UPDATE space_offers SET flag='COMPANY_NEEDS' WHERE id=?`).run(o.id);
      logSpaceEvent("OFFER_BLOCKED", M("ev.sp.offer_blocked", { company: o.company, area: o.area }), "high", { flow: "both", ref: String(o.id), meta: { po: (bad.msg.v as { po?: string } | undefined)?.po ?? null } });
    } else if (!bad && o.flag) d.prepare(`UPDATE space_offers SET flag=NULL WHERE id=?`).run(o.id);
  }
  for (const a of d.prepare(`SELECT key FROM alerts WHERE kind IN ('LISTING_RISK','LEASE_OVER','NO_OFFERS') AND active=1`).all() as { key: string }[]) {
    if (!seen.has(a.key)) d.prepare(`UPDATE alerts SET active=0, updated_tick=? WHERE key=?`).run(sim.tick, a.key);
  }
}

/** Space Forecast agent: free windows, blocked periods, and conflicts with purchasing. */
export function spaceForecastAgent(group: string, trigger: string): AgentResult {
  const r = spacePlanAgent(group, trigger);
  syncSpaceConflicts();
  return r;
}

/** Windows of space the company will NOT need, plus the periods that are blocked and why. */
export function spacePlanAgent(group: string, trigger: string): AgentResult {
  const started = new Date().toISOString();
  const d = db();
  const cfg = loadSettings();
  const sim = getSim();
  const today = sim.sim_date;
  const margin = cfg.n("space.safety_margin_pct");
  const wc = windowCfg(cfg);
  const proj = projectZones(cfg);
  const keyOf = (r: { zone_id: string; start_date: string; to_horizon: number; end_date: string; state: string }) => `${r.state}|${r.zone_id}|${r.start_date}|${r.to_horizon ? "H" : r.end_date}`;
  const before = new Map((d.prepare(`SELECT zone_id, start_date, end_date, to_horizon, state, first_tick FROM space_forecasts`).all() as { zone_id: string; start_date: string; end_date: string; to_horizon: number; state: string; first_tick: number }[]).map((r) => [keyOf(r), r.first_tick]));
  const vacant = d.prepare(`SELECT * FROM space_decisions WHERE kind='KEEP_VACANT' AND reeval_date>?`).all(today) as { zone_id: string; reeval_date: string; detail: string }[];
  const growth = cfg.n("space.reopen_growth_pct");
  const rows: WindowRow[] = [];

  for (const p of proj.values()) {
    const series = listableSeries(p, margin, cfg.b("space.rule_pending_blocks_listing"));
    const pend = listableSeries(p, margin, true);
    const ws = freeWindows(p.dates, series, wc, (x) => addDays(x, 1));
    const horizonEnd = addDays(p.dates[p.dates.length - 1], 1);
    for (const w of ws) {
      const k0 = diffDays(w.start, p.dates[0]), k1 = Math.max(k0, diffDays(w.end, p.dates[0]) - 1);
      const days = Array.from({ length: k1 - k0 + 1 }, (_, i) => k0 + i);
      const peakNeed = Math.max(...days.map((k) => p.need[k]));
      const leasedMax = Math.max(...days.map((k) => p.leased[k]));
      const listedMax = Math.max(...days.map((k) => p.listed[k]));
      const pendShort = Math.max(0, w.area - Math.min(...days.map((k) => pend[k])));
      const firstPend = pendShort > 0 ? days.find((k) => pend[k] < w.area) : undefined;
      const drivers = p.drivers.filter((x) => !x.pending && x.arrival < w.end).slice(0, 3);
      const draft = pendShort > 0 ? p.drivers.filter((x) => x.pending && x.arrival < w.end)[0] : undefined;
      const held = vacant.find((v) => v.zone_id === p.zone_id && v.reeval_date > today && JSON.parse(v.detail).start < w.end && w.start < JSON.parse(v.detail).end
        && w.area < JSON.parse(v.detail).area * (1 + growth / 100));
      rows.push({
        zone_id: p.zone_id, start_date: w.start, end_date: w.end, area: w.area,
        confidence: confidenceOf(diffDays(w.toHorizon ? horizonEnd : w.end, today), cfg.n("space.confidence_high_days"), cfg.n("space.confidence_medium_days")),
        state: held ? "HELD" : "NEW", held_until: held?.reeval_date ?? null, to_horizon: w.toHorizon ? 1 : 0,
        pending_area: pendShort, pending_note: draft ? JSON.stringify(M("sp.pending_warn", { item: draft.item_id, qty: draft.qty, area: draft.area, date: firstPend !== undefined ? p.dates[firstPend] : draft.arrival })) : null,
        inputs: { capacity: p.capacity, fixed: p.fixed, buffer: p.buffer, peak_need: peakNeed, leased: leasedMax, listed: listedMax, margin, window_free: w.area, drivers },
      });
    }
    // blocked periods: days where less than the smallest block is listable, with the orders that need the space
    let runStart = -1, count = 0;
    for (let k = 0; k <= series.length && count < 3; k++) {
      const blocked = k < series.length && series[k] < wc.minBlock;
      if (blocked && runStart < 0) runStart = k;
      if (!blocked && runStart >= 0) {
        const start = p.dates[runStart], end = k === series.length ? addDays(p.dates[k - 1], 1) : p.dates[k];
        const dr = p.drivers.filter((x) => !x.pending && x.arrival <= end).slice(0, 3);
        const peak = Math.max(...p.need.slice(runStart, k));
        rows.push({ zone_id: p.zone_id, start_date: start, end_date: end, area: 0, confidence: "high", state: "BLOCKED", held_until: null, to_horizon: k === series.length ? 1 : 0, pending_area: 0, pending_note: null,
          inputs: { capacity: p.capacity, peak_need: peak, leased: Math.max(...p.leased.slice(runStart, k)), listed: Math.max(...p.listed.slice(runStart, k)), margin, drivers: dr } });
        runStart = -1; count++;
      }
    }
  }

  // listings that the company's own (approved) purchases now squeeze: shortfall per listing, with the order that needs the space
  const lst = d.prepare(`SELECT l.id, l.zone_id, l.start_date, l.end_date, ${LISTING_REMAINING} AS rest FROM space_listings l WHERE l.status IN ('DRAFT','PUBLISHED','PAUSED') ORDER BY l.id`).all() as
    { id: number; zone_id: string; start_date: string; end_date: string; rest: number }[];
  for (const l of lst) {
    const p = proj.get(l.zone_id);
    if (!p || l.rest <= 0) continue;
    const earlier = (k: number) => lst.filter((x) => x.id < l.id && x.zone_id === l.zone_id && x.start_date <= p.dates[k] && p.dates[k] < x.end_date).reduce((a, x) => a + x.rest, 0);
    const to = l.end_date < addDays(p.dates[p.dates.length - 1], 1) ? l.end_date : addDays(p.dates[p.dates.length - 1], 1);
    const from = l.start_date > today ? l.start_date : today;
    if (from >= to) continue;
    const avail = Math.max(0, Math.floor(minOver(p, from, to, (k) => rawFree(p, k) - earlier(k))));
    const tol = (l.rest * cfg.n("space.conflict_tolerance_pct")) / 100; // forecast noise is not a conflict
    if (l.rest <= avail + tol + 1e-6) {
      // pending purchase suggestions never block a listing, but they are shown as a warning
      const availP = Math.max(0, Math.floor(minOver(p, from, to, (k) => Math.max(0, p.capacity - p.needPending[k] - p.leased[k]) - earlier(k))));
      const dr = p.drivers.filter((x) => x.pending && x.arrival < to).sort((a, b) => b.area - a.area)[0];
      if (l.rest > availP + 1e-6 && dr) rows.push({ zone_id: l.zone_id, start_date: dr.arrival > from ? dr.arrival : from, end_date: to, area: l.rest - availP, confidence: "high", state: "WARN", held_until: null, to_horizon: 0, pending_area: 0, pending_note: null, inputs: { listing_id: l.id, rest: l.rest, draft: dr } });
      continue;
    }
    let first = from;
    for (let dt = from; dt < to; dt = addDays(dt, 1)) { const k = diffDays(dt, p.dates[0]); if (rawFree(p, k) - earlier(k) < l.rest) { first = dt; break; } }
    // the cause of a new squeeze is most likely the order placed last; otherwise the largest one that arrives in time
    const cands = p.drivers.filter((x) => !x.pending && x.arrival < to && x.arrival <= addDays(first, 1));
    const drv = [...(cands.length ? cands : p.drivers.filter((x) => !x.pending && x.arrival < to))].sort((a, b) => b.ordered - a.ordered || b.area - a.area)[0];
    rows.push({ zone_id: l.zone_id, start_date: first, end_date: to, area: l.rest - avail, confidence: "high", state: "CONFLICT", held_until: null, to_horizon: 0, pending_area: 0, pending_note: null,
      inputs: { listing_id: l.id, rest: l.rest, ok_area: avail, driver: drv ?? null } });
  }

  d.transaction(() => {
    d.prepare(`DELETE FROM space_forecasts`).run();
    const st = d.prepare(`INSERT INTO space_forecasts(zone_id,start_date,end_date,area,confidence,inputs,state,held_until,to_horizon,pending_area,pending_note,updated_tick,first_tick) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const r of rows) st.run(r.zone_id, r.start_date, r.end_date, r.area, r.confidence, JSON.stringify(r.inputs), r.state, r.held_until, r.to_horizon, r.pending_area, r.pending_note, sim.tick, before.get(keyOf(r)) ?? sim.tick);
  })();
  void logSpaceEvent;

  const wins = rows.filter((r) => r.state === "NEW");
  const res: AgentResult = { msg: M("run.spaceplan", { windows: wins.length, area: wins.reduce((a, r) => a + r.area, 0), held: rows.filter((r) => r.state === "HELD").length, days: cfg.n("space.forecast_days") }) };
  logRun(group, "space-forecast", trigger, started, res.msg);
  return res;
}


/** READ / REASON / ACT sentences of the last run. */
export function spaceForecastStages(res: AgentResult): StageMsgs {
  const v = (res.msg.v ?? {}) as Record<string, number>;
  return {
    read: M("step.space-forecast.read", { zones: countRows("warehouse_zones", "rent_allowed='yes'"), listings: countRows("space_listings", "status IN ('DRAFT','PUBLISHED','PAUSED')"), leases: countRows("space_leases", "status IN ('RESERVED','ACTIVE')") }),
    reason: M("step.space-forecast.reason", { windows: v.windows ?? 0, area: v.area ?? 0, held: v.held ?? 0, days: v.days ?? 0 }),
    act: M("step.space-forecast.act", { rows: countRows("space_forecasts"), conflicts: countRows("alerts", "active=1 AND kind IN ('LISTING_RISK','LEASE_OVER')") }),
  };
}

/** VERIFY: listed area within the free window; leased area plus the company's own need within the zone capacity. */
export function spaceForecastVerify(): VCheck[] {
  const date = getSim().sim_date;
  return [vcheck("listed_area_within_free_window", listedAreaViolations(loadSettings(), date)), vcheck("leased_plus_company_need_within_capacity", capacityViolations(date))];
}
