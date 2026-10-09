// npm run audit [days] [seed ...]  — number audit over a multi-day simulation for several seeds, on a throw-away database.
// Fails loudly (exit code 1) when an invariant is broken. Writes docs/audit-report.json and docs/hourly-vs-daily.md.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { useDatabase, closeDb, db } from "../lib/db";
import { seedDatabase } from "../lib/seed";
import { runAll } from "../lib/agents/coordinator";
import { tick } from "../lib/sim";
import { decide, manualMovement, createManualPo, createSpaceRequest } from "../lib/decisions";
import { listWindow, offerAction, keepWindowVacant, listingAction } from "../lib/space/actions";
import { snapshot } from "../lib/snapshot";
import { hourlyInvariants, dailyInvariants } from "../lib/audit";
import { readDay0State } from "../lib/baselineState";
import { loadSettings } from "../lib/settings";
import { dailyQuantity, demandMultiplier, type SeasonCfg, type EventCfg } from "../lib/calc";
import { addDays } from "../lib/time";

const days = Number(process.argv[2] ?? 30);
const seeds = process.argv.slice(3).map(Number).filter(Number.isFinite);
if (!seeds.length) seeds.push(42, 7, 2026);

interface Failure { seed: number; tick: number; check: string; detail: string }

function diff(a: any, b: any, p = "", out: string[] = []): string[] {
  if (typeof a !== "object" || a === null) { if (a !== b) out.push(`${p}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); return out; }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b ?? {})])) diff(a[k], (b ?? {})[k], `${p}/${k}`, out);
  return out;
}

/** Scripted decisions so that every kind of decision (and its consequence) is exercised during the audit. */
function scriptedActions(tick_: number) {
  const d = db();
  const hour = tick_ % 24, day = Math.floor(tick_ / 24);
  const pending = (kind: string) => d.prepare(`SELECT id FROM recommendations WHERE kind=? AND status='PENDING' ORDER BY id`).all(kind) as { id: number }[];
  const item = (d.prepare(`SELECT item_id FROM items ORDER BY item_id LIMIT 1 OFFSET 3`).get() as { item_id: string }).item_id;
  const safe = (fn: () => unknown) => { try { fn(); } catch { /* an action may legitimately be refused (e.g. space gone) */ } };
  if (hour !== 9) return;
  // the manager keeps deciding: every pending order is approved (emergency spend only within its limit), so budgets are really used up and renewed
  if (day >= 3) for (const r of pending("PO")) safe(() => decide(r.id, "APPROVED"));
  if (day === 1) { const p = pending("PO"); if (p[0]) safe(() => decide(p[0].id, "APPROVED")); if (p[1]) safe(() => decide(p[1].id, "REJECTED")); }
  if (day === 2) { const m = pending("SUPPLIER_MSG"); if (m[0]) safe(() => decide(m[0].id, "APPROVED")); }
  spaceActions(day);
  if (day === 3) { safe(() => manualMovement({ item, kind: "receipt", qty: 5, reason: "audit receipt" })); safe(() => manualMovement({ item, kind: "adjust", qty: -2, reason: "audit adjustment" })); }
  if (day === 4) { safe(() => createManualPo(item, 10, true)); safe(() => createSpaceRequest({ company: "Audit Co", type: loadSettings().s("space.rentable_request_type"), area: 120, months: 2, from: addDays(String((d.prepare(`SELECT sim_date s FROM sim_state`).get() as any).s), 5) })); }
  if (day === 6) { const p = pending("PO"); if (p[0]) safe(() => decide(p[0].id, "APPROVED")); }
}

/** Scripted space decisions: keep one window vacant, list another, answer offers (accept / reject / counter), pause and withdraw. */
function spaceActions(day: number) {
  const safe = (fn: () => unknown) => { try { fn(); } catch { /* refused for a good reason (space needed, offer expired ...) */ } };
  const sp = snapshot().space;
  if (day === 1) { const w = sp.windows.filter((x) => x.state === "NEW"); if (w[0]) safe(() => keepWindowVacant({ zone_id: w[0].zone_id, area: w[0].area, start_date: w[0].start, end_date: w[0].end, reason: "audit" })); if (w[1]) safe(() => listWindow({ zone_id: w[1].zone_id, area: w[1].area, start_date: w[1].start, end_date: w[1].end, price: sp.settings.price_suggested, publish: true })); }
  if (day === 3) { const w = sp.windows.filter((x) => x.state === "NEW" && x.area >= sp.settings.min_block); if (w[0]) safe(() => listWindow({ zone_id: w[0].zone_id, area: Math.min(w[0].area, 200), start_date: w[0].start, end_date: w[0].end, price: sp.settings.price_suggested * 1.8, publish: true })); }
  const pend = sp.offers.filter((o) => o.status === "PENDING");
  if (day >= 4 && day % 3 === 1 && pend[0]) { const o = pend[0]; if (o.eval?.can_accept) safe(() => offerAction(o.id, "accept")); else if (o.eval?.suggest) safe(() => offerAction(o.id, "counter", { terms: { area: o.eval!.suggest!.area, start_date: o.eval!.suggest!.start, end_date: o.eval!.suggest!.end, price: o.eval!.suggest!.price } })); else safe(() => offerAction(o.id, "reject", { reason: "area" })); }
  if (day >= 4 && day % 3 === 2 && pend[1]) safe(() => offerAction(pend[1].id, "reject", { reason: "price" }));
  if (day === 20) { const l = sp.listings.find((x) => x.status === "PUBLISHED"); if (l) safe(() => listingAction(l.id, "pause")); }
  if (day === 22) { const l = sp.listings.find((x) => x.status === "PAUSED"); if (l) safe(() => listingAction(l.id, "withdraw")); }
}

function fingerprint(): string {
  const rows = db().prepare(`SELECT date, tick, item_id, movement_type, quantity, reference FROM stock_movements WHERE sim=1 ORDER BY seq`).all();
  const sp = db().prepare(`SELECT id, status, area, start_date, end_date, price, income FROM space_leases ORDER BY id`).all();
  const of = db().prepare(`SELECT id, company, status, area, price, arrived_tick FROM space_offers ORDER BY id`).all();
  return crypto.createHash("md5").update(JSON.stringify([rows, sp, of])).digest("hex");
}

function runSeed(seed: number, label: string) {
  const file = path.join(os.tmpdir(), `smartstock-audit-${process.pid}-${label}.db`);
  for (const ext of ["", "-wal", "-shm"]) fs.rmSync(file + ext, { force: true });
  useDatabase(file);
  seedDatabase({ overrides: { "sim.seed": seed } });
  runAll({ group: "start", trigger: "start" });
  const failures: Failure[] = [];
  const baseline = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs", "baseline.json"), "utf8")).day0;
  for (const m of diff(baseline, JSON.parse(JSON.stringify(readDay0State())))) failures.push({ seed, tick: 0, check: "day0_equals_baseline", detail: m });
  let checks = 0;
  const record = (tk: number, list: { name: string; ok: boolean; detail: string }[]) => {
    for (const c of list) { checks++; if (!c.ok && !failures.some((f) => f.seed === seed && f.check === c.name && f.detail === c.detail)) failures.push({ seed, tick: tk, check: c.name, detail: c.detail }); }
  };
  record(0, hourlyInvariants());
  const t0 = Date.now();
  for (let i = 0; i < days * 24; i++) {
    const r = tick();
    scriptedActions(r.tick);
    record(r.tick, hourlyInvariants());
    if (r.hour === 0) record(r.tick, dailyInvariants());
    if (r.hour === 0 && (r.tick / 24) % 10 === 0) console.log(`  [seed ${seed}] day ${r.tick / 24}: ${checks} checks, ${failures.length} failure(s), ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  const out = { seed, checks, failures: failures.length, fingerprint: fingerprint(), seconds: Math.round((Date.now() - t0) / 1000), db: file };
  return { out, failures };
}

function weeklyComparison(): string {
  // hourly model vs the original daily model: same daily quantity function, same seed -> planned hourly sums must equal the daily totals
  const cfg = loadSettings();
  const season = cfg.j<SeasonCfg>("demand.season"), events = cfg.j<EventCfg[]>("demand.events"), seed = cfg.n("sim.seed");
  const start = (db().prepare(`SELECT start_date s FROM sim_state`).get() as { s: string }).s;
  const base = new Map((db().prepare(`SELECT item_id, daily_base b FROM sim_baseline`).all() as any[]).map((r) => [r.item_id, r.b]));
  const rows: string[] = ["| item | daily model, 7 days | hourly planned, 7 days | hourly issued, 7 days | note |", "|---|---:|---:|---:|---|"];
  let allEqual = true;
  for (const it of db().prepare(`SELECT item_id FROM items ORDER BY item_id`).all() as { item_id: string }[]) {
    let daily = 0;
    for (let d = 0; d < 7; d++) daily += dailyQuantity({ base: base.get(it.item_id) ?? 0, mult: demandMultiplier(season, events, it.item_id, addDays(start, d)), noise: cfg.n("demand.noise"), seed, date: addDays(start, d), item: it.item_id });
    const h = db().prepare(`SELECT COALESCE(SUM(planned),0) p, COALESCE(SUM(issued),0) i FROM demand_log WHERE item_id=? AND day<7`).get(it.item_id) as { p: number; i: number };
    const note = h.p !== daily ? "MISMATCH" : h.i < h.p ? `stock-out: ${h.p - h.i} unmet` : "";
    if (h.p !== daily) allEqual = false;
    rows.push(`| ${it.item_id} | ${daily} | ${h.p} | ${h.i} | ${note} |`);
  }
  return `# Hourly vs daily model (first 7 days, seed ${seed})\n\nThe hourly model keeps the original daily quantity rule (baseline × seasonality/event factor × seeded noise, stochastic rounding) and only *spreads* each day's quantity over 24 hours, so planned totals are identical by construction (${allEqual ? "verified: all items equal" : "MISMATCH FOUND"}).\nDeliberate differences: (1) issued quantity can be lower than planned when stock runs out inside the day (the daily model could only run out at day end); (2) the day-0 → day-1 gap days of the data are no longer back-filled: the simulation starts at the start date 00:00.\n\n${rows.join("\n")}\n`;
}

const results = seeds.map((s) => runSeed(s, String(s)));
const md = weeklyComparison(); // last seed's database is still open
// determinism: re-run the first seed
const again = runSeed(seeds[0], "again");
const deterministic = again.out.fingerprint === results[0].out.fingerprint;
const different = new Set(results.map((r) => r.out.fingerprint)).size === results.length;
const failures = results.flatMap((r) => r.failures);
if (!deterministic) failures.push({ seed: seeds[0], tick: -1, check: "same_seed_same_result", detail: `${results[0].out.fingerprint} vs ${again.out.fingerprint}` });
if (!different) failures.push({ seed: -1, tick: -1, check: "different_seed_different_result", detail: results.map((r) => r.out.fingerprint).join(",") });

fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync("docs/hourly-vs-daily.md", md);
const report = { days, seeds, runs: results.map((r) => r.out), determinism: { same_seed_same_result: deterministic, different_seed_different_result: different }, failures };
fs.writeFileSync("docs/audit-report.json", JSON.stringify(report, null, 2));
closeDb();
for (const r of [...results, again]) for (const ext of ["", "-wal", "-shm"]) fs.rmSync(r.out.db + ext, { force: true });

console.log(`Audit: ${days} days × ${seeds.length} seeds`);
for (const r of results) console.log(`  seed ${r.out.seed}: ${r.out.checks} checks, ${r.out.failures} failure(s), ${r.out.seconds}s, fingerprint ${r.out.fingerprint.slice(0, 8)}`);
console.log(`  determinism (same seed → same result): ${deterministic ? "PASS" : "FAIL"}; different seed → different result: ${different ? "PASS" : "FAIL"}`);
if (failures.length) {
  console.error(`\nFAILED — ${failures.length} problem(s):`);
  for (const f of failures.slice(0, 40)) console.error(`  [seed ${f.seed} tick ${f.tick}] ${f.check}: ${f.detail}`);
  process.exit(1);
}
console.log("\nAUDIT PASSED");
