import { db } from "../db";
import { zoneFigures } from "../calc";
import { getSim, logRun, M, type AgentResult } from "../core";

export interface Lease { id: number; request_id: string; company: string; zone_id: string; area: number; start_date: string; end_date: string; status: string }

/** Leases that hold area: reserved (approved, not started) and active. */
export const holdingLeases = () => db().prepare(`SELECT * FROM leases WHERE status IN ('RESERVED','ACTIVE') ORDER BY start_date, id`).all() as Lease[];

export interface ZoneRow {
  zone_id: string; zone_name: string; storage_type: string; capacity: number; fixed: number; stock_used: number; used: number; reserved: number;
  rent_allowed: number; free: number; rentable: number; allocated: number; over_capacity: number; net: number; not_rentable: number;
}

/** Live zone figures from the tables (single source for the agent, matching, alerts and the dashboard). */
export function computeZones(): ZoneRow[] {
  const d = db();
  const zones = d.prepare(`SELECT * FROM warehouse_zones ORDER BY zone_id`).all() as {
    zone_id: string; zone_name: string; storage_type: string; capacity_m2: number; fixed_occupied_m2_aisles_equipment: number; reserved_buffer_m2: number; rent_allowed: string;
  }[];
  // used = fixed + sum(quantity_on_hand x space per unit) of the lots held in the zone (the item's zone, or the overflow zone)
  const stockBy = new Map((d.prepare(`SELECT c.zone_id z, SUM(c.quantity_on_hand*i.space_m2_per_unit) m2 FROM current_stock c
    JOIN items i ON i.item_id=c.item_id GROUP BY c.zone_id`).all() as { z: string; m2: number }[]).map((s) => [s.z, s.m2]));
  const activeBy = new Map((d.prepare(`SELECT zone_id z, SUM(area) a FROM leases WHERE status='ACTIVE' GROUP BY zone_id`).all() as { z: string; a: number }[]).map((a) => [a.z, a.a]));
  return zones.map((z) => {
    const f = zoneFigures({
      capacity: z.capacity_m2, fixed: z.fixed_occupied_m2_aisles_equipment, stockUsed: stockBy.get(z.zone_id) ?? 0,
      reserved: z.reserved_buffer_m2, rentAllowed: z.rent_allowed === "yes", allocatedNow: activeBy.get(z.zone_id) ?? 0,
    });
    return {
      zone_id: z.zone_id, zone_name: z.zone_name, storage_type: z.storage_type, capacity: z.capacity_m2, fixed: z.fixed_occupied_m2_aisles_equipment,
      stock_used: stockBy.get(z.zone_id) ?? 0, used: f.used, reserved: z.reserved_buffer_m2, rent_allowed: z.rent_allowed === "yes" ? 1 : 0,
      free: f.free, rentable: f.rentableGross, allocated: f.allocated, over_capacity: f.overCapacity, net: f.rentableNet, not_rentable: f.notRentable,
    };
  });
}

/** Agent 3 (REASON): used / reserved / rentable area per zone, recomputed from live stock; tenants of active leases are subtracted. */
export function spaceAgent(group: string, trigger: string): AgentResult {
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
  const reserved = (d.prepare(`SELECT COALESCE(SUM(area),0) a FROM leases WHERE status='RESERVED'`).get() as { a: number }).a;
  const res: AgentResult = {
    msg: M("run.space", { rentable, detail: rows.filter((z) => z.rent_allowed).map((z) => `${z.zone_id} ${Math.round(z.net)}`).join(" + "),
      allocated: rows.reduce((a, z) => a + z.allocated, 0), reserved, over: rows.reduce((a, z) => a + z.over_capacity, 0) }),
  };
  logRun(group, "space", trigger, started, res.msg);
  return res;
}
