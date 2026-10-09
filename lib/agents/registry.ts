// THE list of agents. The coordinator, the Agent panel, the "How the agents work" tab, the docs script (npm run docs:agents) and the tests all read it.
// Pure data (no database, no server code), so the browser can import it too. The agent code itself lives in lib/agents/<id>.ts.

export const AGENT_IDS = ["forecast", "replenishment", "space-optimization", "alerts", "space-forecast"] as const;
export type AgentId = (typeof AGENT_IDS)[number];
export type AgentStage = "READ" | "REASON" | "ACT";

export interface AgentDef {
  id: AgentId;
  /** 1-based position in the coordinator's cycle. */
  order: number;
  /** Where the agent sits in READ -> REASON -> ACT. */
  stage: AgentStage;
  /** Display names and the one-sentence role come from the locales: agent.<id>, agentdef.<id>.role. */
  file: string;
  reads: readonly string[];
  writes: readonly string[];
  /** Settings key with the hours of the day at which the agent runs. */
  scheduleKey: string;
  /** Also runs after every decision of the manager (the coordinator runs the whole cycle again). */
  afterDecision: boolean;
  /** Names of the VERIFY checks (locale keys vchk.<name>). */
  verifies: readonly string[];
  handsOver: AgentId | null;
}

export const REGISTRY: readonly AgentDef[] = [
  {
    id: "forecast", order: 1, stage: "READ", file: "lib/agents/forecast.ts",
    reads: ["items", "stock_movements", "demand_log", "current_stock", "purchase_orders_open", "settings"], writes: ["forecasts"],
    scheduleKey: "schedule.forecast_hours", afterDecision: true,
    verifies: ["forecast_values_valid", "forecast_covers_every_item"], handsOver: "replenishment",
  },
  {
    id: "replenishment", order: 2, stage: "REASON", file: "lib/agents/replenishment.ts",
    reads: ["forecasts", "items", "current_stock", "purchase_orders_open", "purchasing_budget", "warehouse_zones", "space_leases", "recommendations"], writes: ["replenishment_plan", "recommendations", "events"],
    scheduleKey: "schedule.replenishment_hours", afterDecision: true,
    verifies: ["drafts_valid_and_within_budget_and_room"], handsOver: "space-optimization",
  },
  {
    id: "space-optimization", order: 3, stage: "REASON", file: "lib/agents/space-optimization.ts",
    reads: ["warehouse_zones", "current_stock", "items", "space_leases"], writes: ["zone_space"],
    scheduleKey: "schedule.space_hours", afterDecision: true,
    verifies: ["zones_within_capacity_and_rentable_not_negative"], handsOver: "alerts",
  },
  {
    id: "alerts", order: 4, stage: "ACT", file: "lib/agents/alerts.ts",
    reads: ["forecasts", "items", "current_stock", "purchase_orders_open", "replenishment_plan", "zone_space", "purchasing_budget", "recommendations", "suppliers"], writes: ["alerts", "recommendations", "events"],
    scheduleKey: "schedule.alerts_hours", afterDecision: true,
    verifies: ["alerts_complete_and_unique"], handsOver: "space-forecast",
  },
  {
    id: "space-forecast", order: 5, stage: "REASON", file: "lib/agents/space-forecast.ts",
    reads: ["forecasts", "items", "current_stock", "purchase_orders_open", "recommendations", "warehouse_zones", "space_leases", "space_listings", "space_offers", "space_decisions"], writes: ["space_forecasts", "alerts", "space_offers", "events"],
    scheduleKey: "schedule.space_plan_hours", afterDecision: true,
    verifies: ["listed_area_within_free_window", "leased_plus_company_need_within_capacity"], handsOver: null,
  },
];

export const AGENT_ORDER: readonly AgentId[] = REGISTRY.map((a) => a.id);
export const isAgentId = (x: unknown): x is AgentId => AGENT_IDS.includes(x as AgentId);
export const agentDef = (id: AgentId): AgentDef => REGISTRY.find((a) => a.id === id) as AgentDef;
