import { db } from "./db";
import { zoneFigures } from "./calc";

export interface Lease { id: number; request_id: string; company: string; zone_id: string; area: number; start_date: string; end_date: string; status: string }

/** Leases that hold area: signed but not started (RESERVED) and running (ACTIVE). Zone occupancy data shared by both flows. */
export const holdingLeases = () => db().prepare(`SELECT id, request_id, company, zone_id, area, start_date, end_date, status FROM space_leases WHERE status IN ('RESERVED','ACTIVE') ORDER BY start_date, id`).all() as Lease[];

/** Area of a zone held by tenants on a given date (signed leases: start <= date < end). The only lease data purchasing planning reads. */
export const leasedOn = (zone: string, date: string): number =>
  (db().prepare(`SELECT COALESCE(SUM(area),0) a FROM space_leases WHERE zone_id=? AND status IN ('RESERVED','ACTIVE') AND start_date<=? AND ?<end_date`).get(zone, date, date) as { a: number }).a;

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
  const activeBy = new Map((d.prepare(`SELECT zone_id z, SUM(area) a FROM space_leases WHERE status='ACTIVE' GROUP BY zone_id`).all() as { z: string; a: number }[]).map((a) => [a.z, a.a]));
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
