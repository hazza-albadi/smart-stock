import { db } from "./db";
import { addDays } from "./time";
import { getSim, logEvent, M, type Item, type Lot } from "./core";
import { physicalRoom } from "./calc";
import type { Settings } from "./settings";

export const totalOnHand = (itemId: string): number =>
  (db().prepare(`SELECT COALESCE(SUM(quantity_on_hand),0) q FROM current_stock WHERE item_id=?`).get(itemId) as { q: number }).q;

export function addMovement(date: string, itemId: string, type: "IN" | "OUT", qty: number, ref: string, lotId: string | null, actor = "system") {
  const d = db();
  const n = (d.prepare(`SELECT COUNT(*) c FROM stock_movements WHERE sim=1`).get() as { c: number }).c + 1;
  d.prepare(`INSERT INTO stock_movements(movement_id,date,item_id,movement_type,quantity,reference,balance_after,sim,tick,lot_id,actor) VALUES(?,?,?,?,?,?,?,1,?,?,?)`)
    .run(`SIM-${String(n).padStart(6, "0")}`, date, itemId, type, qty, ref, totalOnHand(itemId), getSim().tick, lotId, actor);
}

/** Physical room (m2) left in a zone for new deliveries: capacity - fixed - stock held there - area of signed rentals (not yet ended). */
export function zoneRoom(zone: string): number {
  const d = db();
  const z = d.prepare(`SELECT capacity_m2 c, fixed_occupied_m2_aisles_equipment f FROM warehouse_zones WHERE zone_id=?`).get(zone) as { c: number; f: number };
  const used = (d.prepare(`SELECT COALESCE(SUM(c.quantity_on_hand*i.space_m2_per_unit),0) m FROM current_stock c JOIN items i ON i.item_id=c.item_id WHERE c.zone_id=?`).get(zone) as { m: number }).m;
  const ten = (d.prepare(`SELECT COALESCE(SUM(area),0) a FROM space_leases WHERE zone_id=? AND status IN ('RESERVED','ACTIVE') AND end_date>?`).get(zone, getSim().sim_date) as { a: number }).a; // a signed rental protects its area from new deliveries from signing on
  return physicalRoom({ capacity: z.c, fixed: z.f, stockUsed: used, tenantsActive: ten });
}

/** Room before tenants: capacity - fixed - stock held there. Leases are taken off by the caller for the date it cares about. */
export const zoneRoomBase = (zone: string): number => {
  const z = db().prepare(`SELECT capacity_m2 c, fixed_occupied_m2_aisles_equipment f FROM warehouse_zones WHERE zone_id=?`).get(zone) as { c: number; f: number };
  const used = (db().prepare(`SELECT COALESCE(SUM(c.quantity_on_hand*i.space_m2_per_unit),0) m FROM current_stock c JOIN items i ON i.item_id=c.item_id WHERE c.zone_id=?`).get(zone) as { m: number }).m;
  return z.c - z.f - used;
};

/** FEFO issue: takes up to `qty` from the lots (earliest expiry first), one movement per lot. Returns the quantity issued. */
export function issueFefo(item: Item, qty: number, date: string, ref: string, actor = "system"): number {
  const d = db();
  const lots = d.prepare(`SELECT * FROM current_stock WHERE item_id=? AND quantity_on_hand>0 ORDER BY expiry_date IS NULL, expiry_date, received_date`).all(item.item_id) as Lot[];
  let left = qty, issued = 0;
  for (const l of lots) {
    if (left <= 0) break;
    const used = Math.min(left, l.quantity_on_hand);
    d.prepare(`UPDATE current_stock SET quantity_on_hand=quantity_on_hand-? WHERE lot_id=?`).run(used, l.lot_id);
    addMovement(date, item.item_id, "OUT", used, ref, l.lot_id, actor);
    left -= used; issued += used;
  }
  return issued;
}

export interface Receipt { got: number; inHome: number; inOver: number; rest: number }

/** Puts goods into stock: home zone first, general-zone goods overflow into the overflow zone, the rest is not accepted. */
export function receiveGoods(cfg: Settings, item: Item, qty: number, date: string, ref: string, actor = "system"): Receipt {
  const d = db();
  const sp = item.space_m2_per_unit;
  const overflow = cfg.s("space.overflow_zone");
  const homeIsGeneral = (d.prepare(`SELECT rent_allowed r FROM warehouse_zones WHERE zone_id=?`).get(item.zone_id) as { r: string }).r === "yes";
  const homeRoom = Math.max(0, Math.floor(zoneRoom(item.zone_id) / sp + 1e-9));
  const inHome = Math.min(qty, homeRoom);
  let inOver = 0;
  if (homeIsGeneral && item.zone_id !== overflow && qty > inHome) inOver = Math.min(qty - inHome, Math.max(0, Math.floor(zoneRoom(overflow) / sp + 1e-9)));
  const expiry = item.shelf_life_days ? addDays(date, item.shelf_life_days) : null;
  const lotId = (z: string) => {
    const base = `LOT-${item.item_id}-${ref}${z === item.zone_id ? "" : "-" + z}`;
    let id = base, n = 1;
    while (d.prepare(`SELECT 1 FROM current_stock WHERE lot_id=?`).get(id)) id = `${base}-r${++n}`;
    return id;
  };
  const put = (zone: string, q: number) => {
    const id = lotId(zone);
    d.prepare(`INSERT INTO current_stock VALUES(?,?,?,?,?,?)`).run(id, item.item_id, zone, q, date, expiry);
    addMovement(date, item.item_id, "IN", q, ref, id, actor);
  };
  if (inHome > 0) put(item.zone_id, inHome);
  if (inOver > 0) put(overflow, inOver);
  return { got: inHome + inOver, inHome, inOver, rest: qty - inHome - inOver };
}

export { logEvent, M };
