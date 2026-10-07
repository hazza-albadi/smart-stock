import { db } from "../db";
import { getSim, logRun, fmt, type AgentResult } from "../core";

export interface Allocation { zone_id: string; area: number }

/** Area already promised to tenants whose space-request proposal was approved. */
export function approvedAllocations(): Allocation[] {
  const rows = db().prepare(`SELECT payload FROM recommendations WHERE kind='SPACE' AND status='APPROVED'`).all() as { payload: string }[];
  return rows.flatMap((r) => (JSON.parse(r.payload).allocations ?? []) as Allocation[]);
}

/** Agent 3 (REASON): used / reserved / rentable area per zone, recomputed from live stock. */
export function spaceAgent(group: string): AgentResult {
  const started = new Date().toISOString();
  const d = db();
  const today = getSim().sim_date;
  const zones = d.prepare(`SELECT * FROM warehouse_zones ORDER BY zone_id`).all() as {
    zone_id: string; capacity_m2: number; fixed_occupied_m2_aisles_equipment: number; reserved_buffer_m2: number; rent_allowed: string;
  }[];
  // used = fixed + sum(quantity_on_hand x space per unit) of the lots held in the zone (= the item's zone, except Z1 overflow held in Z5)
  const stock = d.prepare(`SELECT c.zone_id z, SUM(c.quantity_on_hand*i.space_m2_per_unit) m2 FROM current_stock c
    JOIN items i ON i.item_id=c.item_id GROUP BY c.zone_id`).all() as { z: string; m2: number }[];
  const stockBy = new Map(stock.map((s) => [s.z, s.m2]));
  const alloc = approvedAllocations();

  let rentable = 0, allocated = 0, over = 0;
  d.transaction(() => {
    d.prepare(`DELETE FROM zone_space`).run();
    const st = d.prepare(`INSERT INTO zone_space VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const z of zones) {
      const stockUsed = stockBy.get(z.zone_id) ?? 0;
      const used = z.fixed_occupied_m2_aisles_equipment + stockUsed;
      const free = z.capacity_m2 - used - z.reserved_buffer_m2;
      const canRent = z.rent_allowed === "yes";
      const gross = canRent ? Math.max(0, Math.round(free)) : 0;
      const al = alloc.filter((a) => a.zone_id === z.zone_id).reduce((s, a) => s + a.area, 0);
      const overCap = Math.max(0, used - z.capacity_m2);
      rentable += Math.max(0, gross - al); allocated += al; over += overCap;
      st.run(z.zone_id, z.capacity_m2, z.fixed_occupied_m2_aisles_equipment, stockUsed, used, z.reserved_buffer_m2,
        canRent ? 1 : 0, Math.max(0, free), gross, al, overCap, today);
    }
  })();

  const rows = d.prepare(`SELECT zone_id, rentable, allocated FROM zone_space WHERE rent_allowed=1`).all() as
    { zone_id: string; rentable: number; allocated: number }[];
  const detail = rows.map((r) => `${r.zone_id} ${fmt(Math.max(0, r.rentable - r.allocated))}`).join(" + ");
  const res: AgentResult = {
    en: `Rentable space ${fmt(rentable)} m² (${detail}); ${fmt(allocated)} m² already allocated to approved tenants` +
      `${over > 0 ? `; WARNING: ${fmt(over)} m² over capacity from stock` : ""}. Cold, hazardous and raw-material zones are never rentable.`,
    ar: `المساحة القابلة للتأجير ${fmt(rentable)} م² (${detail}); ${fmt(allocated)} م² مخصصة لمستأجرين تمت الموافقة عليهم` +
      `${over > 0 ? `؛ تحذير: ${fmt(over)} م² فوق السعة بسبب المخزون` : ""}. مناطق التبريد والمواد الخطرة والمواد الخام غير قابلة للتأجير.`,
  };
  logRun(group, "space", started, res.en, res.ar);
  return res;
}
