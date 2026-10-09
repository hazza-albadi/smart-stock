// Coordinator: runs the five agents of lib/agents/registry.ts in order, one after the other, and logs what each did
// (READ -> REASON -> ACT -> VERIFY). The agents never call each other; they talk only through the shared database.
// If an agent's VERIFY fails it is run once more; if it still fails a visible warning is raised. It never blocks the simulation.
import { forecastAgent, forecastStages, forecastVerify } from "./forecast";
import { replenishmentAgent, replenishmentStages, replenishmentVerify } from "./replenishment";
import { spaceOptimizationAgent, spaceOptimizationStages, spaceOptimizationVerify } from "./space-optimization";
import { alertAgent, alertsStages, alertsVerify } from "./alerts";
import { spaceForecastAgent, spaceForecastStages, spaceForecastVerify } from "./space-forecast";
import { AGENT_ORDER, agentDef, type AgentId } from "./registry";
import { applyForced, logSteps, verdictOf, type StageMsgs, type Verdict } from "./steps";
import type { VCheck } from "../checks";
import { db } from "../db";
import { getSim, logEvent, M, type AgentResult } from "../core";
import { loadSettings, type Settings } from "../settings";
import { writeSummary } from "../summary";

export { AGENT_ORDER };
export type AgentName = AgentId;

interface Impl { run: (group: string, trigger: string) => AgentResult; stages: (res: AgentResult) => StageMsgs; verify: () => VCheck[] }

/** What each registered agent does. Must list exactly the ids of the registry (a test checks it). */
const IMPLS: Record<AgentId, Impl> = {
  forecast: { run: forecastAgent, stages: forecastStages, verify: forecastVerify },
  replenishment: { run: replenishmentAgent, stages: replenishmentStages, verify: replenishmentVerify },
  "space-optimization": { run: spaceOptimizationAgent, stages: spaceOptimizationStages, verify: spaceOptimizationVerify },
  alerts: { run: alertAgent, stages: alertsStages, verify: alertsVerify },
  "space-forecast": { run: spaceForecastAgent, stages: spaceForecastStages, verify: spaceForecastVerify },
};
export const implementedAgents = (): string[] => Object.keys(IMPLS);

/** A failing or throwing check never stops the run: the failure itself becomes the result. */
function verifyOf(id: AgentId): Verdict {
  try { return verdictOf(applyForced(id, IMPLS[id].verify())); }
  catch (e) { return verdictOf([{ name: "verify_error", ok: false, detail: e instanceof Error ? e.message : String(e) }]); }
}
function stagesOf(id: AgentId, res: AgentResult): StageMsgs {
  try { return IMPLS[id].stages(res); }
  catch { const m = M("step.unavailable"); return { read: m, reason: m, act: m }; }
}

export function runAgent(id: AgentId, group: string, trigger: string): AgentResult {
  const cfg = loadSettings();
  const retries = Math.max(0, Math.floor(cfg.n("agents.verify_retries")));
  const prev = db().prepare(`SELECT ok FROM agent_steps WHERE agent=? AND stage='VERIFY' ORDER BY id DESC LIMIT 1`).get(id) as { ok: number } | undefined;
  let res = IMPLS[id].run(group, trigger);
  let v = verifyOf(id);
  logSteps(group, id, 1, stagesOf(id, res), v);
  for (let attempt = 2; !v.ok && attempt <= retries + 1; attempt++) {
    res = IMPLS[id].run(group, trigger);
    v = verifyOf(id);
    logSteps(group, id, attempt, stagesOf(id, res), v);
  }
  // still failing after the re-run: a visible warning (an event once per failure streak, and the badge in the Agent panel from the last VERIFY step)
  if (!v.ok && (prev?.ok ?? 1) === 1) {
    const bad = v.checks.find((c) => !c.ok);
    logEvent("AGENT_WARN", null, M("ev.agent_warn", { agent: M(`agent.${id}`), what: M(`vchk.${bad?.name ?? "verify_error"}`), detail: bad?.detail ?? "" }), "high", { ref: id, flow: "both", meta: { agent: id, pause: false } });
  }
  return res;
}

/** Coordinator: runs every agent in registry order (Forecast -> Replenishment -> Space Optimization -> Alerts -> Space Forecast). */
export function runAll(opts: { group?: string; trigger?: string } = {}) {
  const group = opts.group ?? `${getSim().tick}#all`;
  const trigger = opts.trigger ?? "start";
  const out: Record<string, AgentResult> = {};
  for (const a of AGENT_ORDER) out[a] = runAgent(a, group, trigger);
  if (trigger === "start") writeSummary(trigger);
  return out;
}

/** Agents due at the current simulated hour according to the schedule settings (always in registry order). */
export function dueAgents(cfg: Settings, hour: number): AgentName[] {
  return AGENT_ORDER.filter((a) => cfg.j<number[]>(agentDef(a).scheduleKey).includes(hour));
}

/** Runs the scheduled agents for the current hour; returns what ran. After the summary hour the daily summary is written. */
export function runScheduled(): AgentName[] {
  const sim = getSim();
  const cfg = loadSettings();
  const due = dueAgents(cfg, sim.hour);
  const trigger = `h${String(sim.hour).padStart(2, "0")}`;
  const group = `${sim.tick}#${trigger}`;
  for (const a of due) runAgent(a, group, trigger);
  if (cfg.j<number[]>("summary.hours").includes(sim.hour)) writeSummary(trigger);
  return due;
}

/** After "Run analysis" (the five agents called one by one): the summary of the whole cycle. */
export const finishAnalysis = () => writeSummary("manual");

