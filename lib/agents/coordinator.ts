import { forecastAgent } from "./forecast";
import { replenishmentAgent } from "./replenishment";
import { spaceAgent } from "./space";
import { alertAgent } from "./alerts";
import { matchingAgent } from "./matching";
import { getSim, type AgentResult } from "../core";

export const AGENT_ORDER = ["forecast", "replenishment", "space", "alerts", "matching"] as const;
export type AgentName = (typeof AGENT_ORDER)[number];

export async function runAgent(name: AgentName, group: string, useLlm = false): Promise<AgentResult> {
  switch (name) {
    case "forecast": return forecastAgent(group);
    case "replenishment": return replenishmentAgent(group);
    case "space": return spaceAgent(group);
    case "alerts": return alertAgent(group, useLlm);
    case "matching": return matchingAgent(group);
  }
}

/** Coordinator: runs the five agents in order (Forecast -> Replenishment -> Space -> Alert -> Space Matching). */
export async function runAll(opts: { useLlm?: boolean; group?: string } = {}) {
  const group = opts.group ?? `${getSim().sim_date}#${Date.now()}`;
  const out: Record<string, AgentResult> = {};
  for (const a of AGENT_ORDER) out[a] = await runAgent(a, group, opts.useLlm ?? false);
  return out;
}
