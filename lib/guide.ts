// The six steps of the guided demo and when each one has really happened (read from the snapshot; pure, tested).
import type { Snapshot } from "./snapshot";

export const GUIDE_STEPS = [
  { id: "run", section: "purchasing", target: ".clock-block" },
  { id: "risk", section: "purchasing", target: "#risks" },
  { id: "buy", section: "purchasing", target: "#decisions" },
  { id: "list", section: "space", target: "#decisions" },
  { id: "offer", section: "space", target: "#decisions" },
  { id: "income", section: "space", target: "#leases" },
] as const;

/** One flag per step: the clock ran, a stock risk is shown, an order was approved, space was listed, an offer was accepted (a rental exists), rent was earned. */
export function guideDone(s: Snapshot): boolean[] {
  return [
    s.sim.tick > 0,
    s.sim.tick > 0 && s.kpi.items_at_risk > 0,
    s.recs.some((r) => r.kind === "PO" && r.status === "APPROVED"),
    s.space.listings.some((l) => l.published_tick !== null),
    s.space.leases.length > 0,
    s.space.kpi.income_total > 0,
  ];
}
