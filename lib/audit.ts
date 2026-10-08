import { db } from "./db";
import { loadSettings } from "./settings";
import { getSim } from "./core";
import { dailyQuantity, demandMultiplier, type SeasonCfg, type EventCfg } from "./calc";
import { snapshot } from "./snapshot";
import { budgetInfo, budgetFor, periods } from "./budget";
import { diffDays, addDays } from "./time";
import { maxListableRaw } from "./space/forecast";
import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "./csv";

export interface Check { name: string; ok: boolean; detail: string; flow?: "purchasing" | "space" | "both" }
/** Checks that belong to the rental flow; every other check is purchasing (or shared stock/zone data). */
const SPACE_CHECKS = new Set(["listing_gets_minimum_offers_in_window", "leased_plus_company_need_within_capacity", "listed_area_within_free_window", "income_equals_price_area_days", "no_offer_without_published_matching_listing", "space_decisions_timestamped_with_consequence", "no_offers_before_a_listing", "space_ui_matches_database"]);
const all = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).all(...a) as T[];
const one = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).get(...a) as T;
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
const fail = (rows: string[]) => (rows.length ? rows.slice(0, 5).join("; ") + (rows.length > 5 ? ` … (+${rows.length - 5})` : "") : "ok");

/** Cheap invariants that must hold after EVERY simulated hour. */
export function hourlyInvariants(): Check[] {
  const out: Check[] = [];
  const add = (name: string, bad: string[]) => out.push({ name, ok: bad.length === 0, detail: fail(bad) });

  // stock balance per lot = opening + sum(IN) - sum(OUT); and per item
  add("stock_balance_per_lot", all(`SELECT c.lot_id, c.quantity_on_hand q, COALESCE(o.qty,0) + COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE lot_id=c.lot_id AND movement_type='IN'),0)
      - COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE lot_id=c.lot_id AND movement_type='OUT'),0) e
    FROM current_stock c LEFT JOIN stock_opening o ON o.lot_id=c.lot_id`).filter((r) => !near(r.q, r.e)).map((r) => `${r.lot_id}: ${r.q} vs ${r.e}`));
  add("stock_balance_per_item", all(`SELECT i.item_id, COALESCE((SELECT SUM(quantity_on_hand) FROM current_stock WHERE item_id=i.item_id),0) q,
      COALESCE((SELECT SUM(qty) FROM stock_opening WHERE item_id=i.item_id),0) + COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE sim=1 AND item_id=i.item_id AND movement_type='IN'),0)
      - COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE sim=1 AND item_id=i.item_id AND movement_type='OUT'),0) e FROM items i`)
    .filter((r) => !near(r.q, r.e)).map((r) => `${r.item_id}: ${r.q} vs ${r.e}`));
  add("no_negative_stock", all(`SELECT lot_id, quantity_on_hand q FROM current_stock WHERE quantity_on_hand < 0`).map((r) => `${r.lot_id} ${r.q}`));

  // budget: a period exists for today, committed spend never exceeds the budget plus approved emergency spend, the UI shows what the tables hold
  const snap = snapshot();
  const bud = budgetInfo();
  const periodsNow = periods();
  const bd: string[] = [];
  // (the simulation starts one day before the first period of the data; that day belongs to the first period)
  if (snap.sim.date >= periodsNow[0].period_start && !periodsNow.some((p) => p.period_start <= snap.sim.date && snap.sim.date <= p.period_end)) bd.push(`no budget period covers ${snap.sim.date}`);
  for (let i = 1; i < periodsNow.length; i++) if (periodsNow[i].period_start !== addDays(periodsNow[i - 1].period_end, 1)) bd.push(`gap between periods ${i} and ${i + 1}`);
  for (const p of periodsNow) {
    const f = budgetFor(p, periodsNow);
    const topups = one(`SELECT COALESCE(SUM(amount),0) a FROM budget_topups WHERE period_id=?`, p.id).a;
    if (!near(topups, p.topup)) bd.push(`period ${p.id}: top-ups ${p.topup} vs ledger ${topups}`);
    if (f.committed > p.total_purchasing_budget_omr + p.rollover + p.topup + 1e-6) bd.push(`period ${p.period_start}: committed ${f.committed} > budget ${p.total_purchasing_budget_omr} + rollover ${p.rollover} + emergency ${p.topup}`);
  }
  if (!near(snap.budget.committed, bud.committed) || !near(snap.kpi.budget_remaining, bud.free)) bd.push("UI budget differs from the tables");
  add("budget_period_exists_and_spend_within_budget_plus_emergency", bd);

  // nothing runs to zero unnoticed: an item whose stock lasts less than its delivery time has an open suggestion (any funding state, incl. an emergency request),
  // an incoming order, a recent decision of the manager (rejection cooldown) or a visible "no room" reason in the plan
  const cooldown = loadSettings().n("repl.reject_cooldown_hours");
  const stuck: string[] = [];
  for (const it of snap.items) {
    if (it.lasts_hours === null || it.lasts_hours >= it.lead_time_days * 24) continue;
    const pending = one(`SELECT 1 FROM recommendations WHERE kind='PO' AND status='PENDING' AND item_id=?`, it.item_id);
    const incoming = one(`SELECT 1 FROM purchase_orders_open WHERE item_id=? AND status IN ('OPEN','DELAYED_BY_SUPPLIER')`, it.item_id);
    const rejected = one(`SELECT 1 FROM recommendations WHERE kind='PO' AND status='REJECTED' AND item_id=? AND ?-COALESCE(decided_tick,0)<?`, it.item_id, snap.sim.tick, cooldown);
    const noRoom = one(`SELECT 1 FROM replenishment_plan WHERE item_id=? AND status='DEFERRED' AND reason LIKE '%repl.r.noroom%'`, it.item_id);
    const overstockNow = it.status === "Overstock";
    if (!pending && !incoming && !rejected && !noRoom && !overstockNow) stuck.push(`${it.item_id}: lasts ${Math.round(it.lasts_hours)} h, delivery ${it.lead_time_days} d, no suggestion / order / reason`);
  }
  add("short_stock_always_explained", stuck);

  // PO values keep their origin: data POs equal the CSV, approved POs equal the cost stored in the decision (receipts/splits never change the value)
  const origin: string[] = [];
  const unitCost = new Map(all(`SELECT item_id, unit_cost_omr c FROM items`).map((r) => [r.item_id, r.c]));
  const csv = parseCsv(fs.readFileSync(path.join(process.cwd(), "smartstock_data", "purchase_orders_open.csv"), "utf8"));
  const rowsByRoot = new Map<string, number>();
  for (const p of all(`SELECT po_id, item_id, quantity, premium FROM purchase_orders_open`)) {
    const root = String(p.po_id).replace(/-R\d+$/, "");
    rowsByRoot.set(root, (rowsByRoot.get(root) ?? 0) + p.quantity * unitCost.get(p.item_id) * (1 + p.premium));
  }
  for (const c of csv) { const v = Number(c.quantity) * (unitCost.get(c.item_id) ?? 0); if (!near(rowsByRoot.get(c.po_id) ?? -1, v)) origin.push(`${c.po_id}: ${rowsByRoot.get(c.po_id)} vs csv ${v}`); }
  for (const d of all(`SELECT detail FROM decisions WHERE kind='PO' AND decision='APPROVED'`)) { const det = JSON.parse(d.detail); if (!near(rowsByRoot.get(det.po) ?? -1, det.cost)) origin.push(`${det.po}: ${rowsByRoot.get(det.po)} vs decision ${det.cost}`); }
  add("po_values_match_origin", origin);

  // zones: independent recomputation straight from SQL
  const zr = all(`SELECT w.zone_id, w.capacity_m2 cap, w.fixed_occupied_m2_aisles_equipment fx, w.reserved_buffer_m2 rs, w.rent_allowed ra,
      COALESCE((SELECT SUM(c.quantity_on_hand*i.space_m2_per_unit) FROM current_stock c JOIN items i ON i.item_id=c.item_id WHERE c.zone_id=w.zone_id),0) st,
      COALESCE((SELECT SUM(area) FROM space_leases WHERE zone_id=w.zone_id AND status='ACTIVE'),0) ten FROM warehouse_zones w`);
  const bad: string[] = [];
  let sumUsed = 0, sumRent = 0;
  for (const z of zr) {
    const used = z.fx + z.st;
    sumUsed += used;
    const gross = z.ra === "yes" ? Math.max(0, Math.round(z.cap - used - z.rs)) : 0;
    const net = Math.max(0, gross - z.ten);
    sumRent += net;
    const s = snap.zones.find((x) => x.zone_id === z.zone_id);
    if (!s) { bad.push(`${z.zone_id} missing`); continue; }
    if (!near(s.used, used)) bad.push(`${z.zone_id} used ${s.used} vs ${used}`);
    if (!near(s.net, net)) bad.push(`${z.zone_id} rentable ${s.net} vs ${net}`);
    if (used + z.ten > z.cap + 1e-6 && !(z.ten > 0 && one(`SELECT 1 FROM alerts WHERE key=? AND active=1`, `LEASE_OVER:${z.zone_id}`))) bad.push(`${z.zone_id} above capacity: ${used + z.ten} > ${z.cap}`);
    if (z.ra !== "yes" && s.net !== 0) bad.push(`${z.zone_id} not rentable but shows ${s.net}`);
  }
  if (!near(snap.zones.reduce((a, z) => a + z.used, 0), sumUsed)) bad.push("sum of zones used differs from warehouse total");
  if (!near(snap.kpi.rentable_m2, sumRent)) bad.push(`rentable total ${snap.kpi.rentable_m2} vs ${sumRent}`);
  add("zones_used_rentable_capacity", bad);

  // ---- space flow invariants ----
  const sp = snap.space;
  const cfg = loadSettings();
  const dpm = cfg.n("space.days_per_month");
  // leased area + the company's own need (fixed + stock held there) never exceeds the zone capacity at any hour
  const cap: string[] = [];
  for (const z of all(`SELECT w.zone_id, w.capacity_m2 c, w.fixed_occupied_m2_aisles_equipment f,
      COALESCE((SELECT SUM(x.quantity_on_hand*i.space_m2_per_unit) FROM current_stock x JOIN items i ON i.item_id=x.item_id WHERE x.zone_id=w.zone_id),0) st,
      COALESCE((SELECT SUM(area) FROM space_leases WHERE zone_id=w.zone_id AND status IN ('RESERVED','ACTIVE') AND start_date<=? AND ?<end_date),0) ls FROM warehouse_zones w`, snap.sim.date, snap.sim.date))
    if (z.f + z.st + z.ls > z.c + 1e-6 && !one(`SELECT 1 FROM alerts WHERE key=? AND active=1`, `LEASE_OVER:${z.zone_id}`)) cap.push(`${z.zone_id}: leased ${Math.round(z.ls)} + need ${Math.round(z.f + z.st)} > ${z.c}`);
  add("leased_plus_company_need_within_capacity", cap);
  // listed area never exceeds what the forecast leaves free (otherwise a conflict must be flagged)
  const lst: string[] = [];
  const flagged = new Set(all(`SELECT inputs FROM space_forecasts WHERE state='CONFLICT'`).map((r) => JSON.parse(r.inputs).listing_id));
  for (const l of all(`SELECT * FROM space_listings WHERE status IN ('DRAFT','PUBLISHED','PAUSED')`)) {
    const rest = l.area - one(`SELECT COALESCE(SUM(area),0) a FROM space_leases WHERE listing_id=?`, l.id).a;
    const room = maxListableRaw(cfg, l.zone_id, l.start_date < snap.sim.date ? snap.sim.date : l.start_date, l.end_date, l.id);
    if (rest > room + (rest * cfg.n("space.conflict_tolerance_pct")) / 100 + 1e-6 && !flagged.has(l.id)) lst.push(`listing ${l.id}: ${rest} m² listed, forecast leaves ${room}`);
    if (rest > 0 && l.status === "PUBLISHED" && l.published_tick === null) lst.push(`listing ${l.id} published without a time`);
  }
  add("listed_area_within_free_window", lst);
  // income = price x area x days leased
  const inc: string[] = [];
  for (const l of all(`SELECT * FROM space_leases`)) {
    const dur = diffDays(l.end_date, l.start_date);
    // the day's rent is booked by the first hourly step of that day, so at hour 0 of a state it is not booked yet
    const expectDays = l.status === "ENDED" ? dur : l.status === "ACTIVE" ? Math.max(0, Math.min(dur, diffDays(snap.sim.date, l.start_date) + (snap.sim.hour >= 1 ? 1 : 0))) : 0;
    if (l.income_days !== expectDays) inc.push(`lease ${l.id}: ${l.income_days} days vs ${expectDays}`);
    if (!near(l.income, (l.area * l.price / dpm) * l.income_days)) inc.push(`lease ${l.id}: income ${l.income} vs ${(l.area * l.price / dpm) * l.income_days}`);
  }
  add("income_equals_price_area_days", inc);
  // no offer without a published matching listing; cold / hazardous (and any zone that is not for rent) never listed, offered or leased
  const off: string[] = [];
  for (const o of all(`SELECT o.*, l.published_tick, l.zone_id lz FROM space_offers o LEFT JOIN space_listings l ON l.id=o.listing_id`)) {
    if (o.lz === null || o.lz === undefined) { off.push(`offer ${o.id}: no listing`); continue; }
    if (o.published_tick === null || o.arrived_tick < o.published_tick) off.push(`offer ${o.id}: arrived before the listing was published`);
    const rq = one(`SELECT required_storage_type t FROM space_requests WHERE request_id=?`, o.request_id);
    if (!rq || rq.t !== cfg.s("space.rentable_request_type")) off.push(`offer ${o.id}: storage type ${rq?.t} cannot be offered`);
    if (one(`SELECT rent_allowed r FROM warehouse_zones WHERE zone_id=?`, o.lz)?.r !== "yes") off.push(`offer ${o.id}: zone not for rent`);
  }
  for (const t of ["space_listings", "space_leases"]) for (const r of all(`SELECT x.id FROM ${t} x JOIN warehouse_zones w ON w.zone_id=x.zone_id WHERE w.rent_allowed<>'yes'`)) off.push(`${t} ${r.id} in a zone that is not for rent`);
  add("no_offer_without_published_matching_listing", off);
  // reliable arrival: a reasonably priced, continuously published listing received the minimum number of offers inside the window
  const windowH = cfg.n("space.offer_window_days") * 24;
  const arr: string[] = [];
  for (const l of all(`SELECT * FROM space_listings WHERE status='PUBLISHED' AND guaranteed>0 AND resumed_tick IS NULL`)) {
    const since = l.window_tick ?? l.published_tick;
    if (snap.sim.tick - since < windowH) continue;
    if (one(`SELECT 1 FROM space_leases WHERE signed_tick<=?`, since + windowH)) continue; // a rental signed meanwhile may take a planned company away
    const got = one(`SELECT COUNT(*) n FROM space_offers WHERE listing_id=? AND status<>'SCHEDULED' AND arrived_tick<=?`, l.id, since + windowH).n;
    if (got < l.guaranteed) arr.push(`listing ${l.id}: ${got} offers in the window, ${l.guaranteed} promised`);
  }
  add("listing_gets_minimum_offers_in_window", arr);
  // every space decision has a timestamp and a visible consequence
  const sdc: string[] = [];
  for (const d of all(`SELECT * FROM space_decisions`)) {
    if (d.tick === null || d.tick === undefined) { sdc.push(`space decision ${d.id}: no timestamp`); continue; }
    if (d.kind === "OFFER" && (d.action === "ACCEPT" || d.action === "COUNTER_ACCEPTED") && !one(`SELECT 1 FROM space_leases WHERE id=?`, d.lease_id)) sdc.push(`space decision ${d.id}: no lease`);
    if (d.kind === "LISTING" && (d.action === "PUBLISH" || d.action === "DRAFT") && !one(`SELECT 1 FROM space_listings WHERE id=?`, d.listing_id)) sdc.push(`space decision ${d.id}: no listing`);
    if (d.kind === "KEEP_VACANT" && !d.reeval_date) sdc.push(`space decision ${d.id}: no re-evaluation date`);
  }
  add("space_decisions_timestamped_with_consequence", sdc);
  // day 0: nothing from the tenant pool is visible before a listing exists
  add("no_offers_before_a_listing", one(`SELECT COUNT(*) n FROM space_offers`).n > 0 && !one(`SELECT 1 FROM space_listings WHERE published_tick IS NOT NULL`) ? ["offers exist but nothing was ever published"] : []);
  // the UI shows what the database holds
  const sdb: string[] = [];
  if (!near(sp.kpi.leased_m2, one(`SELECT COALESCE(SUM(area),0) a FROM space_leases WHERE status IN ('RESERVED','ACTIVE')`).a)) sdb.push("leased area differs");
  if (!near(sp.kpi.income_total, one(`SELECT COALESCE(SUM(income),0) a FROM space_leases`).a)) sdb.push("income differs");
  if (sp.kpi.offers_waiting !== one(`SELECT COUNT(*) n FROM space_offers WHERE status='PENDING'`).n) sdb.push("waiting offers differ");
  add("space_ui_matches_database", sdb);

  // recommendations: no duplicate pending ones
  add("no_duplicate_pending_recommendations", [
    ...all(`SELECT key, COUNT(*) n FROM recommendations WHERE status='PENDING' GROUP BY key HAVING n>1`).map((r) => `${r.key} ×${r.n}`),
    ...all(`SELECT item_id, COUNT(*) n FROM recommendations WHERE status='PENDING' AND kind='PO' AND source='agent' GROUP BY item_id HAVING n>1`).map((r) => `PO draft ${r.item_id} ×${r.n}`),
  ]);

  // decisions: timestamped, with a visible consequence or an explicit "no effect"
  const db_: string[] = [];
  for (const d of all(`SELECT * FROM decisions`)) {
    if (d.tick === null || d.tick === undefined) { db_.push(`decision ${d.id} has no timestamp`); continue; }
    const det = JSON.parse(d.detail ?? "{}");
    if (d.kind === "PO" && d.decision === "APPROVED" && !one(`SELECT 1 FROM purchase_orders_open WHERE po_id=?`, det.po)) db_.push(`decision ${d.id}: PO ${det.po} missing`);
    if (d.kind === "PO" && d.decision === "REJECTED" && (() => { const r = one(`SELECT status, reopen_count FROM recommendations WHERE id=?`, d.rec_id); return r?.status === "APPROVED" && !r.reopen_count; })()) db_.push(`decision ${d.id}: rejected but approved`);
    if (d.kind === "SUPPLIER_MSG" && det.effect !== "none") db_.push(`decision ${d.id}: message decision without explicit no-effect`);
  }
  add("decisions_timestamped_with_consequence", db_);

  // clock
  const s = getSim();
  add("clock_consistent", [
    ...(s.sim_date === snap.sim.date ? [] : ["sim_date mismatch"]),
    ...(s.tick === s.day * 24 + s.hour ? [] : ["tick != day*24+hour"]),
    ...(s.data_end < s.sim_date ? [] : ["data_end must be before today"]),
  ]);

  // UI-to-DB reconciliation: what the dashboard receives equals an independent recomputation
  const rec: string[] = [];
  for (const it of snap.items) {
    const q = one(`SELECT COALESCE(SUM(quantity_on_hand),0) q FROM current_stock WHERE item_id=?`, it.item_id).q;
    if (!near(it.on_hand, q)) rec.push(`${it.item_id} on_hand ${it.on_hand} vs ${q}`);
    if (Number.isNaN(it.weeks_cover) || !Number.isFinite(it.weeks_cover) || it.on_hand < 0) rec.push(`${it.item_id} invalid number`);
  }
  const m = one(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN movement_type='IN' THEN quantity END),0) qi, COALESCE(SUM(CASE WHEN movement_type='OUT' THEN quantity END),0) qo FROM stock_movements WHERE sim=1`);
  if (snap.totals.n !== m.n || !near(snap.totals.qin, m.qi) || !near(snap.totals.qout, m.qo)) rec.push("movement totals differ");
  if (snap.kpi.pending !== one(`SELECT COUNT(*) n FROM recommendations WHERE status='PENDING'`).n) rec.push("pending approvals differ");
  add("ui_matches_database", rec);
  return out;
}

/** Heavier invariants (run once per simulated day and on the live "Audit" button). */
export function dailyInvariants(): Check[] {
  const out: Check[] = [];
  const add = (name: string, bad: string[]) => out.push({ name, ok: bad.length === 0, detail: fail(bad) });
  const cfg = loadSettings();
  const seed = cfg.n("sim.seed");
  const season = cfg.j<SeasonCfg>("demand.season"), events = cfg.j<EventCfg[]>("demand.events");
  const base = new Map(all(`SELECT item_id, daily_base b FROM sim_baseline`).map((r) => [r.item_id, r.b]));
  const start = getSim().start_date;
  const profileSum = cfg.j<number[]>("demand.hourly_profile").reduce((a, b) => a + b, 0);
  const bad: string[] = [], bad2: string[] = [];
  for (const g of all(`SELECT day, item_id, SUM(planned) p, SUM(issued) i, COUNT(*) n FROM demand_log GROUP BY day, item_id`)) {
    const date = new Date(Date.parse(start + "T00:00:00Z") + g.day * 86400000).toISOString().slice(0, 10);
    const q = dailyQuantity({ base: base.get(g.item_id) ?? 0, mult: demandMultiplier(season, events, g.item_id, date), noise: cfg.n("demand.noise"), seed, date, item: g.item_id });
    if (g.p !== q) bad.push(`${g.item_id} day ${g.day}: hours sum ${g.p} vs daily ${q}`);
    const mv = one(`SELECT COALESCE(SUM(quantity),0) q FROM stock_movements WHERE sim=1 AND item_id=? AND date=? AND reference='SALES/ISSUE'`, g.item_id, date).q;
    if (!near(mv, g.i)) bad2.push(`${g.item_id} ${date}: movements ${mv} vs issued ${g.i}`);
  }
  add("hourly_amounts_sum_to_daily_quantity", [...bad, ...(profileSum > 0 ? [] : ["hourly profile sums to zero"])]);
  add("issued_demand_equals_movements", bad2);
  // replenishment caps orders by room: agent POs must arrive in full (no held remainder / blocked receipt)
  // zone room is respected when an order is placed: an approved agent order never exceeds the room its zones had for it (later holds are visible "no space" events, not silent)
  add("agent_pos_fit_when_placed", all(`SELECT id, detail FROM decisions WHERE kind='PO' AND decision='APPROVED'`).filter((r) => { const x = JSON.parse(r.detail); return !x.manual && x.room_units !== undefined && x.room_units !== null && x.qty > x.room_units + 1e-9; }).map((r) => `decision ${r.id}`));
  add("planned_never_below_issued", all(`SELECT day, item_id, hour FROM demand_log WHERE issued > planned`).map((r) => `${r.item_id} d${r.day} h${r.hour}`));
  return out;
}

export function runInvariants(full = true): Check[] {
  return [...hourlyInvariants(), ...(full ? dailyInvariants() : [])].map((c) => ({ ...c, flow: SPACE_CHECKS.has(c.name) ? "space" as const : "purchasing" as const }));
}

/** Stores the result so the UI can show the "data health" indicator. */
export function recordAudit(kind: string, checks: Check[]) {
  const failures = checks.filter((c) => !c.ok);
  const s = getSim();
  const by = (f: string) => { const l = checks.filter((c) => (c.flow ?? (SPACE_CHECKS.has(c.name) ? "space" : "purchasing")) === f); return { passed: l.filter((c) => c.ok).length, total: l.length }; };
  db().prepare(`INSERT INTO audit_results(tick,ts,kind,passed,total,failures,by_flow) VALUES(?,?,?,?,?,?,?)`)
    .run(s.tick, new Date().toISOString(), kind, checks.length - failures.length, checks.length, JSON.stringify(failures), JSON.stringify({ purchasing: by("purchasing"), space: by("space") }));
  return { passed: checks.length - failures.length, total: checks.length, failures };
}
