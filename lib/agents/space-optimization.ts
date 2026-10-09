/**
 * Name: Space Optimization (id: space-optimization)
 * Stage: REASON
 * Role: Works out, zone by zone, how much area the stock uses, how much is held back and how much can be rented out.
 * Reads: warehouse_zones, current_stock, items, space_leases
 * Writes: zone_space
 * VERIFY: no zone above its capacity because of the company's own stock; rentable area never negative or NaN (checks.zoneSpaceViolations)
 * Runs when: setting schedule.space_hours (and after every decision)
 * Hands over to: alerts (through the zone_space table, via the coordinator)
 */
import { db } from "../db";
import { getSim, logRun, M, type AgentResult } from "../core";
import { computeZones } from "../zones";
import { zoneSpaceViolations, vcheck, type VCheck, type ZoneSpaceRow } from "../checks";
import { countRows, type StageMsgs } from "./steps";

/** Used / reserved / rentable area per zone, recomputed from live stock; tenants of active leases are subtracted. */
export function spaceOptimizationAgent(group: string, trigger: string): AgentResult {
  const started = new Date().toISOString();
  const d = db();
  const sim = getSim();
  const rows = computeZones();
  d.transaction(() => {
    d.prepare(`DELETE FROM zone_space`).run();
    const st = d.prepare(`INSERT INTO zone_space VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const z of rows) st.run(z.zone_id, z.capacity, z.fixed, z.stock_used, z.used, z.reserved, z.rent_allowed, z.free, z.rentable, z.allocated, z.over_capacity, sim.tick);
  })();
  const rentable = rows.reduce((a, z) => a + z.net, 0);
  const reserved = (d.prepare(`SELECT COALESCE(SUM(area),0) a FROM space_leases WHERE status='RESERVED'`).get() as { a: number }).a;
  const res: AgentResult = {
    msg: M("run.space", { rentable, detail: rows.filter((z) => z.rent_allowed).map((z) => `${z.zone_id} ${Math.round(z.net)}`).join(" + "),
      allocated: rows.reduce((a, z) => a + z.allocated, 0), reserved, over: rows.reduce((a, z) => a + z.over_capacity, 0) }),
  };
  logRun(group, "space-optimization", trigger, started, res.msg);
  return res;
}

/** READ / REASON / ACT sentences of the last run. */
export function spaceOptimizationStages(res: AgentResult): StageMsgs {
  const v = (res.msg.v ?? {}) as Record<string, number>;
  return {
    read: M("step.space-optimization.read", { zones: countRows("warehouse_zones"), lots: countRows("current_stock"), leases: countRows("space_leases", "status IN ('RESERVED','ACTIVE')") }),
    reason: M("step.space-optimization.reason", { rentable: v.rentable ?? 0, allocated: v.allocated ?? 0, over: v.over ?? 0 }),
    act: M("step.space-optimization.act", { n: countRows("zone_space") }),
  };
}

/** VERIFY: the zone figures the agent just stored. */
export const spaceOptimizationVerify = (): VCheck[] =>
  [vcheck("zones_within_capacity_and_rentable_not_negative", zoneSpaceViolations(db().prepare(`SELECT zone_id, capacity, used, allocated, rentable FROM zone_space`).all() as ZoneSpaceRow[]))];
