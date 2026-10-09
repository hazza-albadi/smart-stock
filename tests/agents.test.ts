import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { useDatabase, db, closeDb, ensureTables } from "../lib/db";
import { seedDatabase } from "../lib/seed";
import { runAll, runAgent, finishAnalysis, implementedAgents } from "../lib/agents/coordinator";
import { REGISTRY, AGENT_IDS, AGENT_ORDER, type AgentId } from "../lib/agents/registry";
import { STAGES, forceVerifyFailure, lastVerifies } from "../lib/agents/steps";
import { advance } from "../lib/sim";
import { snapshot } from "../lib/snapshot";
import { loadSettings } from "../lib/settings";
import { getSim } from "../lib/core";
import { decide, undo, createManualPo } from "../lib/decisions";
import { listWindow, keepWindowVacant, offerAction, undoSpaceDecision } from "../lib/space/actions";
import { createPoDraft, backfillDrafts, listDrafts, updateDraft } from "../lib/drafts";
import { buildSummary, latestSummary, writeSummary } from "../lib/summary";
import { hourlyInvariants } from "../lib/audit";
import { render } from "../lib/render";
import { draftViolations, zoneSpaceViolations, alertViolations } from "../lib/checks";
import { agentTableBlock, replaceAgentTable } from "../lib/agents/doc-table";
import en from "../locales/en.json";
import ar from "../locales/ar.json";

const E = en as Record<string, string>, A = ar as Record<string, string>;
const file = path.join(os.tmpdir(), `smartstock-agents-${process.pid}.db`);
const q = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).all(...a) as T[];
const one = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).get(...a) as T;
const fresh = (seed = 42) => { seedDatabase({ overrides: { "sim.auto_pause_critical": false, "sim.seed": seed } }); runAll({ group: "start", trigger: "start" }); };
before(() => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(file + e, { force: true }); useDatabase(file); });
test.after(() => { closeDb(); for (const e of ["", "-wal", "-shm"]) fs.rmSync(file + e, { force: true }); });

const NO_KEY = (lang: "en" | "ar", m: unknown) => { const t = render(lang, m as never); assert.ok(t && !/\{\w|^[a-z]+\.[a-z_.-]+$/.test(t), `rendered "${t}"`); return t; };

// ------------------------------------------------------------------ the stage log
test("every agent run writes exactly four stages in order, all readable in both languages", () => {
  fresh();
  for (const id of AGENT_IDS) {
    const rows = q(`SELECT * FROM agent_steps WHERE agent=? AND run_group='start' ORDER BY id`, id);
    assert.deepEqual(rows.map((r) => r.stage), [...STAGES], id);
    assert.ok(rows.every((r) => r.attempt === 1 && r.ok === 1 && r.tick === 0 && typeof r.sim_date === "string"), id);
    for (const r of rows) { NO_KEY("en", JSON.parse(r.summary)); NO_KEY("ar", JSON.parse(r.summary)); }
  }
  assert.equal(q(`SELECT COUNT(*) n FROM agent_runs`)[0].n, AGENT_IDS.length, "the one-line run summary still works");
  assert.ok(q(`SELECT * FROM agent_runs`).every((r) => AGENT_IDS.includes(r.agent)), "the same ids everywhere");
});

test("the READ / REASON / ACT sentences carry real counts from the tables", () => {
  fresh();
  const read = JSON.parse(one(`SELECT summary FROM agent_steps WHERE agent='forecast' AND stage='READ'`).summary);
  assert.equal(read.v.items, one(`SELECT COUNT(*) n FROM items`).n);
  const act = JSON.parse(one(`SELECT summary FROM agent_steps WHERE agent='space-optimization' AND stage='ACT'`).summary);
  assert.equal(act.v.n, one(`SELECT COUNT(*) n FROM zone_space`).n);
  const alerts = JSON.parse(one(`SELECT summary FROM agent_steps WHERE agent='alerts' AND stage='ACT'`).summary);
  assert.equal(alerts.v.active, one(`SELECT COUNT(*) n FROM alerts WHERE active=1`).n);
});

test("a failing self-check runs the agent once more, logs both attempts and shows a warning; the simulation goes on", () => {
  fresh();
  forceVerifyFailure("forecast", 2);
  runAgent("forecast", "t-force", "manual");
  const rows = q(`SELECT attempt, stage, ok FROM agent_steps WHERE agent='forecast' AND run_group='t-force' ORDER BY id`);
  assert.equal(rows.length, 8, "two attempts x four stages");
  assert.deepEqual([...new Set(rows.map((r) => r.attempt))], [1, 2]);
  assert.equal(rows.filter((r) => r.stage === "VERIFY").map((r) => r.ok).join(), "0,0");
  assert.equal(q(`SELECT COUNT(*) n FROM agent_runs WHERE run_group='t-force'`)[0].n, 2, "both runs are logged");
  const ev = q(`SELECT * FROM events WHERE type='AGENT_WARN'`);
  assert.equal(ev.length, 1);
  NO_KEY("en", JSON.parse(ev[0].msg)); NO_KEY("ar", JSON.parse(ev[0].msg));
  assert.equal(lastVerifies().forecast.warning, true);
  assert.equal(snapshot().agents.find((a) => a.id === "forecast")?.verify?.ok, false, "badge data reaches the Agent panel");
  assert.equal(snapshot().steps.filter((s) => s.run_group === "t-force").length, 8);
  advance({ hours: 2 }); // never blocks the simulation
  assert.equal(getSim().tick, 2);
  // a healthy run clears the warning
  runAgent("forecast", "t-ok", "manual");
  assert.equal(lastVerifies().forecast.warning, false);
});

test("a check that fails once is fixed by the re-run: two attempts, no warning", () => {
  fresh();
  forceVerifyFailure("alerts", 1);
  runAgent("alerts", "t-once", "manual");
  const v = q(`SELECT attempt, ok FROM agent_steps WHERE agent='alerts' AND run_group='t-once' AND stage='VERIFY' ORDER BY id`);
  assert.deepEqual(v.map((r) => [r.attempt, r.ok]), [[1, 0], [2, 1]]);
  assert.equal(q(`SELECT COUNT(*) n FROM events WHERE type='AGENT_WARN'`)[0].n, 0);
});

test("the real self-checks pass over a 3-day run, and every run has four stages (audit)", () => {
  fresh();
  advance({ hours: 72 });
  assert.equal(q(`SELECT COUNT(*) n FROM agent_steps WHERE stage='VERIFY' AND ok=0`)[0].n, 0, JSON.stringify(q(`SELECT agent, summary FROM agent_steps WHERE stage='VERIFY' AND ok=0 LIMIT 3`)));
  const checks = hourlyInvariants();
  for (const name of ["every_agent_run_has_four_stages", "every_approved_po_has_a_draft", "every_space_decision_has_a_reply_draft"]) {
    const c = checks.find((x) => x.name === name);
    assert.ok(c, name);
    assert.ok(c.ok, `${name}: ${c.detail}`);
  }
});

test("the pure VERIFY helpers catch what they are meant to catch", () => {
  const ok = { item_id: "I", unit: "kg", qty: 20, cost: 5, funding: "FUNDED", within_limit: true, edited: false };
  const o = { free: 100, emergencyRoom: 10, step: () => 10, roomUnits: () => 50 };
  assert.deepEqual(draftViolations([ok], o), []);
  assert.equal(draftViolations([{ ...ok, qty: 0 }], o).length > 0, true, "zero quantity");
  assert.equal(draftViolations([{ ...ok, qty: 25 }], o).length > 0, true, "not a multiple of the step");
  assert.equal(draftViolations([{ ...ok, qty: 60 }], o).length > 0, true, "more than the room of the zone");
  assert.equal(draftViolations([{ ...ok, cost: 500 }], o).length > 0, true, "funded above the budget");
  assert.deepEqual(draftViolations([{ ...ok, qty: 25, edited: true }], o), [], "the manager's own quantity is not judged");
  assert.ok(zoneSpaceViolations([{ zone_id: "z", capacity: 100, used: 50, allocated: 0, rentable: -1 }]).length);
  assert.ok(zoneSpaceViolations([{ zone_id: "z", capacity: 100, used: 120, allocated: 0, rentable: 0 }]).length);
  assert.deepEqual(zoneSpaceViolations([{ zone_id: "z", capacity: 100, used: 50, allocated: 20, rentable: 10 }]), []);
  const m = { k: "x.y" };
  const al = { key: "A", kind: "STOCKOUT", severity: "High", title: m, detail: [m], ignore_msg: m };
  const kinds = new Set(["STOCKOUT"]);
  assert.deepEqual(alertViolations([al], kinds, ["High"]), []);
  assert.ok(alertViolations([al, al], kinds, ["High"]).some((x) => x.includes("duplicate")));
  assert.ok(alertViolations([{ ...al, kind: "NOPE" }], kinds, ["High"]).length);
  assert.ok(alertViolations([{ ...al, severity: "Huge" }], kinds, ["High"]).length);
  assert.ok(alertViolations([{ ...al, ignore_msg: null }], kinds, ["High"]).length);
});

// ------------------------------------------------------------------ the daily summary
test("the daily summary is built from the database and reconciles with an independent SQL recomputation", () => {
  fresh();
  advance({ hours: 9 }); // the 08:00 run wrote one
  const s = latestSummary()!;
  assert.ok(s && s.trigger === "h08" && s.tick === 8, "written after the 08:00 run");
  const now = buildSummary("check");
  assert.ok(now.tick >= s.tick);
  const cur = writeSummary("manual");
  const t = getSim().tick;
  assert.equal(cur.risks.total, one(`SELECT COUNT(*) n FROM alerts WHERE active=1 AND severity IN ('Critical','High')`).n);
  assert.equal(cur.risks.top.length, Math.min(loadSettings().n("summary.top_risks"), cur.risks.total));
  assert.equal(cur.decisions.pending, one(`SELECT COUNT(*) n FROM recommendations WHERE status='PENDING'`).n);
  assert.equal(cur.decisions.oldest_age_h, t - one(`SELECT MIN(created_tick) m FROM recommendations WHERE status='PENDING'`).m);
  const used = one(`SELECT COALESCE(SUM(p.quantity*i.unit_cost_omr*(1+p.premium)),0) v FROM purchase_orders_open p JOIN items i ON i.item_id=p.item_id`).v;
  const total = one(`SELECT total_purchasing_budget_omr + rollover + topup v FROM purchasing_budget ORDER BY period_start LIMIT 1`).v;
  assert.ok(Math.abs(cur.budget.used - used) < 1e-6, `used ${cur.budget.used} vs ${used}`);
  assert.ok(Math.abs(cur.budget.free - (total - used)) < 1e-6);
  assert.equal(cur.space.leased_m2, one(`SELECT COALESCE(SUM(area),0) a FROM space_leases WHERE status IN ('RESERVED','ACTIVE')`).a);
  assert.equal(cur.space.income, one(`SELECT COALESCE(SUM(income),0) a FROM space_leases`).a);
  assert.equal(cur.space.offers_waiting, one(`SELECT COUNT(*) n FROM space_offers WHERE status='PENDING'`).n);
  const listable = q(`SELECT zone_id, MAX(area) m FROM space_forecasts WHERE state='NEW' GROUP BY zone_id`).reduce((a, r) => a + r.m, 0);
  assert.equal(cur.space.listable_m2, listable);
  assert.equal(cur.space.listable_m2, snapshot().space.kpi.listable_total_m2, "same figure as the Space screen");
  // texts are messages with the numbers as values, readable in both languages
  assert.equal(cur.lines.budget.v!.free, cur.budget.free);
  for (const m of Object.values(cur.lines)) { NO_KEY("en", m); NO_KEY("ar", m); }
  for (const r of cur.risks.top) { NO_KEY("en", r.title); NO_KEY("ar", r.title); }
  assert.equal(snapshot().summary?.tick, t);
});

test("'Run analysis' (the five agents one by one) writes the summary after the last agent", () => {
  fresh();
  const n = q(`SELECT COUNT(*) n FROM daily_summary`)[0].n;
  for (const a of AGENT_ORDER) runAgent(a, "manual#1", "manual");
  finishAnalysis();
  assert.equal(q(`SELECT COUNT(*) n FROM daily_summary`)[0].n, n + 1);
  assert.equal(latestSummary()!.trigger, "manual");
});

// ------------------------------------------------------------------ drafts
const approveFirstPo = () => {
  const rec = snapshot().recs.find((r) => r.kind === "PO" && r.status === "PENDING" && r.payload.status !== "MANUAL" && r.payload.funding !== "NEEDS_EXTRA" && r.payload.funding !== "DEFERRED");
  assert.ok(rec, "a fundable draft exists on day 0");
  const out = decide(rec.id, "APPROVED");
  const dec = q(`SELECT * FROM decisions WHERE id=?`, out.decisionId)[0];
  return { rec, po: JSON.parse(dec.detail).po as string, decisionId: out.decisionId };
};

test("approving a purchase order creates a ready supplier message with the numbers of the order record", () => {
  fresh();
  const { po } = approveFirstPo();
  const d = listDrafts(50).find((x) => x.ref === po)!;
  assert.ok(d, "draft for the approved order");
  const row = one(`SELECT p.*, i.unit, i.unit_cost_omr, s.supplier_name FROM purchase_orders_open p JOIN items i ON i.item_id=p.item_id JOIN suppliers s ON s.supplier_id=p.supplier_id WHERE p.po_id=?`, po);
  assert.equal(d.kind, "SUPPLIER_ORDER"); assert.equal(d.flow, "purchasing"); assert.equal(d.sent, 0);
  assert.equal(d.to_name, row.supplier_name);
  const v = d.parts[0].v as Record<string, any>;
  assert.equal(v.po, po); assert.equal(v.qty, row.quantity); assert.equal(v.unit, row.unit); assert.equal(v.item, row.item_id);
  assert.equal(v.date, row.expected_arrival, "requested delivery date comes from the order");
  assert.ok(Math.abs(v.cost - row.quantity * row.unit_cost_omr * (1 + row.premium)) < 1e-6);
  assert.equal(v.start, snapshot().budget.start); assert.equal(v.end, snapshot().budget.end);
  const names = Object.fromEntries(snapshot().items.map((i) => [i.item_id, i]));
  for (const lang of ["en", "ar"] as const) {
    const text = [render(lang, d.subject, { items: names }), render(lang, d.parts, { items: names })].join("\n");
    assert.ok(text.includes(po) && text.includes(row.supplier_name), lang);
    assert.ok(!/\{\w/.test(text), "no placeholder left: " + text);
  }
  assert.equal(createPoDraft(po), null, "one draft per order");
});

test("a manual emergency order gets its draft when it is approved; the text can be edited and marked sent; undo removes it", () => {
  fresh();
  const item = q(`SELECT item_id FROM items ORDER BY item_id LIMIT 1`)[0].item_id;
  createManualPo(item, 10, true);
  const rec = snapshot().recs.find((r) => r.kind === "PO" && r.payload.status === "MANUAL")!;
  assert.equal(q(`SELECT COUNT(*) n FROM drafts`)[0].n, 0, "nothing to send before the order exists");
  const out = decide(rec.id, "APPROVED");
  const po = JSON.parse(q(`SELECT detail FROM decisions WHERE id=?`, out.decisionId)[0].detail).po as string;
  const d = listDrafts(10).find((x) => x.ref === po)!;
  assert.equal((d.parts[0].v as any).emerg, 1);
  updateDraft(d.id, { body: { ar: "نص معدل", en: "Edited text" } });
  updateDraft(d.id, { sent: true });
  const e = listDrafts(10).find((x) => x.id === d.id)!;
  assert.deepEqual(e.body_override, { ar: "نص معدل", en: "Edited text" });
  assert.equal(e.sent, 1); assert.ok(e.sent_tick !== null);
  updateDraft(d.id, { sent: false });
  assert.equal(listDrafts(10).find((x) => x.id === d.id)!.sent, 0);
  undo(out.decisionId);
  assert.equal(q(`SELECT COUNT(*) n FROM drafts WHERE ref=?`, po)[0].n, 0, "the undone order takes its draft with it");
});

test("a database from an older version is migrated without losing data, and existing approved orders get their drafts", () => {
  fresh();
  const { po } = approveFirstPo();
  db().exec(`DROP TABLE drafts; DROP TABLE agent_steps; DROP TABLE daily_summary;`);
  const created = ensureTables();
  assert.deepEqual(created.sort(), ["agent_steps", "daily_summary", "drafts"]);
  backfillDrafts();
  assert.equal(q(`SELECT COUNT(*) n FROM drafts WHERE ref=?`, po)[0].n, 1);
  assert.deepEqual(ensureTables(), [], "idempotent");
  runAll({ group: "after-migration", trigger: "decision" });
  assert.equal(q(`SELECT COUNT(DISTINCT stage) n FROM agent_steps WHERE run_group='after-migration' AND agent='alerts'`)[0].n, 4);
});

test("every space decision (accept, reject, counter-offer, keep vacant) gets a bilingual reply draft with its reason", () => {
  fresh();
  const cfg = loadSettings();
  const win = () => snapshot().space.windows.filter((w) => w.state === "NEW").sort((a, b) => b.area - a.area);
  const [w1, w2] = win();
  assert.ok(w1 && w2, "two free windows on day 0");
  keepWindowVacant({ zone_id: w2.zone_id, area: w2.area, start_date: w2.start, end_date: w2.end, reason: "reserve" });
  const kv = q(`SELECT * FROM space_decisions WHERE kind='KEEP_VACANT'`)[0];
  const dv = q(`SELECT * FROM drafts WHERE ref=?`, `space:${kv.id}`)[0];
  assert.ok(dv && dv.to_name === null && dv.flow === "space");
  NO_KEY("en", JSON.parse(dv.parts)); NO_KEY("ar", JSON.parse(dv.parts));
  listWindow({ zone_id: w1.zone_id, area: w1.area, start_date: w1.start, end_date: w1.end, price: cfg.n("space.price_suggested"), publish: true });
  for (let i = 0; i < 12 && snapshot().space.offers.filter((o) => o.status === "PENDING").length < 2; i++) advance({ hours: 24 });
  const pend = snapshot().space.offers.filter((o) => o.status === "PENDING");
  assert.ok(pend.length >= 2, "two offers arrived");
  const [o1, o2] = pend;
  // reject: the reason is the first failing automatic check, or the manager's own reason
  offerAction(o1.id, "reject", { reason: "price" });
  const dr = q(`SELECT * FROM drafts WHERE kind='SPACE_REPLY' AND json_extract(meta,'$.action')='reject'`)[0];
  assert.equal(dr.to_name, o1.company);
  const rejectParts = JSON.parse(dr.parts)[0];
  assert.equal(rejectParts.v.company, o1.company); assert.equal(rejectParts.v.area, o1.area);
  assert.ok(rejectParts.v.why && rejectParts.v.why.k, "a reason is given");
  for (const lang of ["en", "ar"] as const) { const t = render(lang, JSON.parse(dr.parts)); assert.ok(t.includes(o1.company) && !/\{\w/.test(t), t); }
  // accept or counter the second one
  const ev = o2.eval;
  if (ev?.can_accept) {
    offerAction(o2.id, "accept");
    const da = q(`SELECT * FROM drafts WHERE json_extract(meta,'$.action')='accept'`)[0];
    assert.equal(da.to_name, o2.company); assert.equal(JSON.parse(da.parts)[0].v.area, o2.area);
    assert.ok(JSON.parse(da.meta).lease > 0);
  } else if (ev?.suggest) {
    offerAction(o2.id, "counter", { terms: { area: ev.suggest.area, start_date: ev.suggest.start, end_date: ev.suggest.end, price: ev.suggest.price } });
    const dc = q(`SELECT * FROM drafts WHERE json_extract(meta,'$.action')='counter'`)[0];
    assert.equal(JSON.parse(dc.parts)[0].v.c_area, ev.suggest.area);
  }
  assert.ok(q(`SELECT COUNT(*) n FROM drafts WHERE flow='space'`)[0].n >= 3);
  // undoing a space decision takes its reply with it
  const rj = q(`SELECT id FROM space_decisions WHERE kind='OFFER' AND action='REJECT'`)[0];
  undoSpaceDecision(rj.id);
  assert.equal(q(`SELECT COUNT(*) n FROM drafts WHERE ref=?`, `space:${rj.id}`)[0].n, 0);
  const c = hourlyInvariants().find((x) => x.name === "every_space_decision_has_a_reply_draft")!;
  assert.ok(c.ok, c.detail);
});

// ------------------------------------------------------------------ the registry
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

test("every agent file starts with the same header and says what the registry says", () => {
  const fields = ["Name", "Stage", "Role", "Reads", "Writes", "VERIFY", "Runs when", "Hands over to"];
  for (const a of REGISTRY) {
    const src = read(a.file);
    const m = src.match(/^\/\*\*\n((?: \*.*\n)+?) \*\//);
    assert.ok(m, `${a.file}: header comment missing`);
    const lines = m![1].split("\n").map((l) => l.replace(/^ \* ?/, ""));
    const got: Record<string, string> = {};
    for (const f of fields) {
      const l = lines.find((x) => x.startsWith(`${f}: `));
      assert.ok(l && l.length > f.length + 3, `${a.file}: header field "${f}" missing or empty`);
      got[f] = l!.slice(f.length + 2).trim();
    }
    assert.ok(got.Name.includes(`id: ${a.id}`), `${a.file}: Name must carry the registry id`);
    assert.equal(got.Stage, a.stage, `${a.file}: stage`);
    const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean).sort();
    assert.deepEqual(list(got.Reads), [...a.reads].sort(), `${a.file}: Reads`);
    assert.deepEqual(list(got.Writes), [...a.writes].sort(), `${a.file}: Writes`);
    assert.ok(got["Runs when"].includes(a.scheduleKey), `${a.file}: Runs when`);
    if (a.handsOver) assert.ok(got["Hands over to"].startsWith(a.handsOver), `${a.file}: Hands over to`);
  }
});

test("the registry, the coordinator, the files and the settings agree; one folder, one file per agent", () => {
  assert.deepEqual([...implementedAgents()].sort(), [...AGENT_IDS].sort(), "coordinator implements exactly the registry");
  assert.deepEqual(REGISTRY.map((a) => a.id), [...AGENT_ORDER]);
  assert.deepEqual(REGISTRY.map((a) => a.order), REGISTRY.map((_, i) => i + 1));
  assert.deepEqual(AGENT_ORDER, ["forecast", "replenishment", "space-optimization", "alerts", "space-forecast"]);
  const cfg = loadSettings();
  for (const a of REGISTRY) {
    assert.ok(fs.existsSync(path.join(process.cwd(), a.file)), a.file);
    assert.equal(a.file, `lib/agents/${a.id}.ts`);
    assert.ok(Array.isArray(cfg.raw(a.scheduleKey)), a.scheduleKey);
    assert.ok(!a.handsOver || AGENT_IDS.includes(a.handsOver));
  }
  for (const f of ["coordinator.ts", "registry.ts", "steps.ts"]) assert.ok(fs.existsSync(path.join(process.cwd(), "lib/agents", f)), f);
  const files = fs.readdirSync(path.join(process.cwd(), "lib/agents")).filter((f) => f.endsWith(".ts") && !["coordinator.ts", "registry.ts", "steps.ts", "checks.ts", "doc-table.ts", "stage-names.ts"].includes(f));
  assert.deepEqual(files.sort(), REGISTRY.map((a) => `${a.id}.ts`).sort(), "exactly one file per agent");
  assert.equal(AGENT_ORDER.join(), snapshot().agent_order.join(), "the Agent panel reads the same list");
  assert.deepEqual(snapshot().agents.map((a) => a.id), [...AGENT_ORDER]);
});

test("no code keeps its own list of agent names or the old ids", () => {
  const walk = (d: string, out: string[] = []) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f.name)) out.push(p); } return out; };
  const src = ["lib", "components", "app", "scripts"].flatMap((d) => walk(d)).filter((f) => !f.endsWith("registry.ts"));
  for (const f of src) {
    const t = fs.readFileSync(f, "utf8");
    assert.ok(!/["']spaceplan["']/.test(t), `${f}: old id "spaceplan"`);
    assert.ok(!/\[\s*"forecast"\s*,\s*"replenishment"/.test(t), `${f}: duplicated agent list`);
  }
});

test("every agent id, role, stage sentence and check name is in both locale files", () => {
  const need: string[] = [];
  for (const a of REGISTRY) {
    need.push(`agent.${a.id}`, `agentdef.${a.id}.role`, `step.${a.id}.read`, `step.${a.id}.reason`, `step.${a.id}.act`, ...a.verifies.map((v) => `vchk.${v}`));
  }
  for (const s of STAGES) need.push(`stage.${s}`);
  need.push("step.verify.ok", "step.verify.fail", "ev.agent_warn", "vchk.verify_error", "tab.drafts", "help.agents", "sum.title", "sum.risks", "sum.decisions", "sum.budget", "sum.space", "sum.offers", "draft.po.subject", "draft.po.body", "draft.sp.accept.body", "draft.sp.reject.body", "draft.sp.counter.body", "draft.sp.vacant.body");
  assert.deepEqual(need.filter((k) => !(k in E) || !(k in A) || !E[k] || !A[k]), []);
  for (const id of ["space", "spaceplan"]) assert.ok(!(`agent.${id}` in E), `old key agent.${id} removed`);
});

test("the agent table of docs/ARCHITECTURE.md and README.md is the one generated from the registry", () => {
  const block = agentTableBlock(E, A);
  const doc = read("docs/ARCHITECTURE.md");
  assert.equal(replaceAgentTable(doc, block), doc, "run npm run docs:agents");
  for (const a of REGISTRY) assert.ok(doc.includes(a.id) && doc.includes(a.file));
});

test("all new tables exist in the schema and the seed state is unchanged by them", () => {
  fresh();
  for (const t of ["agent_steps", "daily_summary", "drafts"]) assert.ok(one(`SELECT 1 FROM sqlite_master WHERE name=?`, t), t);
  assert.equal(q(`SELECT COUNT(*) n FROM drafts`)[0].n, 0, "no draft before any decision");
  assert.equal(q(`SELECT COUNT(*) n FROM daily_summary`)[0].n, 1, "one summary at the start");
});
