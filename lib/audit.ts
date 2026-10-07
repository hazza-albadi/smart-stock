import { db } from "./db";
import { loadSettings } from "./settings";
import { getSim } from "./core";
import { dailyQuantity, demandMultiplier, type SeasonCfg, type EventCfg } from "./calc";
import { snapshot } from "./snapshot";
import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "./csv";

export interface Check { name: string; ok: boolean; detail: string }
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

  // budget
  const b = one(`SELECT total_purchasing_budget_omr t FROM purchasing_budget LIMIT 1`);
  const committed = one(`SELECT COALESCE(SUM(p.quantity*i.unit_cost_omr*(1+p.premium)),0) c FROM purchase_orders_open p JOIN items i ON i.item_id=p.item_id`).c;
  const snap = snapshot();
  add("budget_committed_and_free", [
    ...(near(snap.budget.committed, committed) ? [] : [`committed ${snap.budget.committed} vs ${committed}`]),
    ...(near(snap.kpi.budget_remaining, b.t - committed) ? [] : [`free ${snap.kpi.budget_remaining} vs ${b.t - committed}`]),
    ...(snap.budget.over === (b.t - committed < -1e-9) ? [] : ["over-budget flag does not match the figures"]),
  ]);

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
      COALESCE((SELECT SUM(area) FROM leases WHERE zone_id=w.zone_id AND status='ACTIVE'),0) ten FROM warehouse_zones w`);
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
    if (used + z.ten > z.cap + 1e-6) bad.push(`${z.zone_id} above capacity: ${used + z.ten} > ${z.cap}`);
    if (z.ra !== "yes" && s.net !== 0) bad.push(`${z.zone_id} not rentable but shows ${s.net}`);
  }
  if (!near(snap.zones.reduce((a, z) => a + z.used, 0), sumUsed)) bad.push("sum of zones used differs from warehouse total");
  if (!near(snap.kpi.rentable_m2, sumRent)) bad.push(`rentable total ${snap.kpi.rentable_m2} vs ${sumRent}`);
  add("zones_used_rentable_capacity", bad);

  // leases: never above what the zone can hold; at-risk commitments must be flagged by an alert
  const lb: string[] = [];
  for (const z of snap.zones.filter((x) => x.rent_allowed)) {
    const committed = all(`SELECT COALESCE(SUM(area),0) a FROM leases WHERE zone_id=? AND status IN ('RESERVED','ACTIVE') AND end_date>?`, z.zone_id, snap.sim.date)[0].a;
    if (committed > z.rentable + 1e-6 && !all(`SELECT 1 FROM alerts WHERE key=? AND active=1`, `LEASE_RISK:${z.zone_id}`).length) lb.push(`${z.zone_id}: committed ${committed} > rentable ${z.rentable} without a lease-risk alert`);
  }
  add("leases_within_rentable_or_flagged", lb);

  // recommendations: no duplicate pending ones
  add("no_duplicate_pending_recommendations", [
    ...all(`SELECT key, COUNT(*) n FROM recommendations WHERE status='PENDING' GROUP BY key HAVING n>1`).map((r) => `${r.key} ×${r.n}`),
    ...all(`SELECT item_id, COUNT(*) n FROM recommendations WHERE status='PENDING' AND kind='PO' AND source='agent' GROUP BY item_id HAVING n>1`).map((r) => `PO draft ${r.item_id} ×${r.n}`),
    ...all(`SELECT request_id, COUNT(*) n FROM recommendations WHERE status='PENDING' AND kind='SPACE' GROUP BY request_id HAVING n>1`).map((r) => `space ${r.request_id} ×${r.n}`),
  ]);

  // decisions: timestamped, with a visible consequence or an explicit "no effect"
  const db_: string[] = [];
  for (const d of all(`SELECT * FROM decisions`)) {
    if (d.tick === null || d.tick === undefined) { db_.push(`decision ${d.id} has no timestamp`); continue; }
    const det = JSON.parse(d.detail ?? "{}");
    if (d.kind === "PO" && d.decision === "APPROVED" && !one(`SELECT 1 FROM purchase_orders_open WHERE po_id=?`, det.po)) db_.push(`decision ${d.id}: PO ${det.po} missing`);
    if (d.kind === "PO" && d.decision === "REJECTED" && one(`SELECT status FROM recommendations WHERE id=?`, d.rec_id)?.status === "APPROVED") db_.push(`decision ${d.id}: rejected but approved`);
    if (d.kind === "SPACE" && d.decision === "APPROVED" && det.allocations && !all(`SELECT 1 FROM leases WHERE request_id=?`, d.request_id).length) db_.push(`decision ${d.id}: no lease created`);
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
  add("planned_never_below_issued", all(`SELECT day, item_id, hour FROM demand_log WHERE issued > planned`).map((r) => `${r.item_id} d${r.day} h${r.hour}`));
  return out;
}

export function runInvariants(full = true): Check[] {
  return [...hourlyInvariants(), ...(full ? dailyInvariants() : [])];
}

/** Stores the result so the UI can show the "data health" indicator. */
export function recordAudit(kind: string, checks: Check[]) {
  const failures = checks.filter((c) => !c.ok);
  const s = getSim();
  db().prepare(`INSERT INTO audit_results(tick,ts,kind,passed,total,failures) VALUES(?,?,?,?,?,?)`)
    .run(s.tick, new Date().toISOString(), kind, checks.length - failures.length, checks.length, JSON.stringify(failures));
  return { passed: checks.length - failures.length, total: checks.length, failures };
}
