import { forecastAgent } from "./forecast";
import { replenishmentAgent } from "./replenishment";
import { spaceAgent } from "./space";
import { alertAgent } from "./alerts";
import { matchingAgent } from "./matching";
import { getSim, type AgentResult } from "../core";
import { loadSettings, type Settings } from "../settings";

export const AGENT_ORDER = ["forecast", "replenishment", "space", "alerts", "matching"] as const;
export type AgentName = (typeof AGENT_ORDER)[number];

/** Settings key holding the hours of day at which each agent runs (matching has no clock schedule: it follows space / decisions). */
const SCHEDULE: Record<AgentName, string | null> = {
  forecast: "schedule.forecast_hours", replenishment: "schedule.replenishment_hours", space: "schedule.space_hours",
  alerts: "schedule.alerts_hours", matching: null,
};

export function runAgent(name: AgentName, group: string, trigger: string): AgentResult {
  switch (name) {
    case "forecast": return forecastAgent(group, trigger);
    case "replenishment": return replenishmentAgent(group, trigger);
    case "space": return spaceAgent(group, trigger);
    case "alerts": return alertAgent(group, trigger);
    case "matching": return matchingAgent(group, trigger);
  }
}

/** Coordinator: runs the five agents in order (Forecast -> Replenishment -> Space -> Alert -> Space Matching). */
export function runAll(opts: { group?: string; trigger?: string } = {}) {
  const group = opts.group ?? `${getSim().tick}#all`;
  const out: Record<string, AgentResult> = {};
  for (const a of AGENT_ORDER) out[a] = runAgent(a, group, opts.trigger ?? "start");
  return out;
}

/** Agents due at the current simulated hour according to the schedule settings (always in coordinator order). */
export function dueAgents(cfg: Settings, hour: number): AgentName[] {
  const due = AGENT_ORDER.filter((a) => SCHEDULE[a] && cfg.j<number[]>(SCHEDULE[a] as string).includes(hour));
  // space matching follows the space agent: rentable area may have changed
  if (due.includes("space") && !due.includes("matching")) due.push("matching");
  return due;
}

/** Runs the scheduled agents for the current hour; returns what ran. */
export function runScheduled(): AgentName[] {
  const sim = getSim();
  const due = dueAgents(loadSettings(), sim.hour);
  if (!due.length) return [];
  const trigger = `h${String(sim.hour).padStart(2, "0")}`;
  const group = `${sim.tick}#${trigger}`;
  for (const a of due) runAgent(a, group, trigger);
  return due;
}
