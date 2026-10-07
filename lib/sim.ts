import { db } from "./db";
import { addDays } from "./time";
import { rand } from "./rng";
import { demandMultiplier } from "./seasonality";
import { getItems, getSim, logEvent, fmt, uAr, type Item, type Lot, type Po } from "./core";
import { runAll } from "./agents/coordinator";
import { seedDatabase } from "./seed";
import { approvedAllocations } from "./agents/space";

/** Physical room (m2) left in a zone: capacity - fixed area - stock held there - area promised to approved tenants. */
function zoneRoom(zone: string): number {
  const d = db();
  const z = d.prepare(`SELECT capacity_m2 c, fixed_occupied_m2_aisles_equipment f FROM warehouse_zones WHERE zone_id=?`).get(zone) as { c: number; f: number };
  const used = (d.prepare(`SELECT COALESCE(SUM(c.quantity_on_hand*i.space_m2_per_unit),0) m FROM current_stock c JOIN items i ON i.item_id=c.item_id WHERE c.zone_id=?`).get(zone) as { m: number }).m;
  const tenants = approvedAllocations().filter((a) => a.zone_id === zone).reduce((s, a) => s + a.area, 0);
  return z.c - z.f - used - tenants;
}

const NOISE = 0.2; // +/-20% daily noise around the baseline

function totalOnHand(itemId: string): number {
  return (db().prepare(`SELECT COALESCE(SUM(quantity_on_hand),0) q FROM current_stock WHERE item_id=?`).get(itemId) as { q: number }).q;
}

function addMovement(date: string, itemId: string, type: "IN" | "OUT", qty: number, ref: string) {
  const bal = totalOnHand(itemId);
  const d = db();
  const n = (d.prepare(`SELECT COUNT(*) c FROM stock_movements WHERE sim=1`).get() as { c: number }).c + 1;
  d.prepare(`INSERT INTO stock_movements(movement_id,date,item_id,movement_type,quantity,reference,balance_after,sim) VALUES(?,?,?,?,?,?,?,1)`)
    .run(`SIM-${String(n).padStart(5, "0")}`, date, itemId, type, qty, ref, bal);
}

/** Stochastic rounding keeps integer quantities while preserving the mean (needed for slow movers). */
const stochRound = (x: number, r: number) => Math.floor(x) + (r < x - Math.floor(x) ? 1 : 0);

function processDay(date: string, seed: number, items: Item[]) {
  const d = db();

  // 1) Lots that passed their expiry date are written off (FEFO).
  const expired = d.prepare(`SELECT * FROM current_stock WHERE expiry_date IS NOT NULL AND expiry_date < ? AND quantity_on_hand>0`).all(date) as Lot[];
  for (const l of expired) {
    const it = items.find((i) => i.item_id === l.item_id) as Item;
    d.prepare(`DELETE FROM current_stock WHERE lot_id=?`).run(l.lot_id);
    addMovement(date, l.item_id, "OUT", l.quantity_on_hand, "EXPIRED");
    const value = l.quantity_on_hand * it.unit_cost_omr;
    logEvent("EXPIRED", l.item_id,
      `انتهت صلاحية الدفعة ${l.lot_id}: شُطب ${fmt(l.quantity_on_hand)} ${uAr(it.unit)} من ${it.name_ar} (${fmt(value)} ر.ع)`,
      `Lot ${l.lot_id} expired: ${fmt(l.quantity_on_hand)} ${it.unit} of ${it.name_en} written off (${fmt(value)} OMR)`, "high");
  }

  // 2) Purchase orders reaching their expected arrival are received (delayed POs only on their new date).
  const due = d.prepare(`SELECT * FROM purchase_orders_open WHERE status IN ('OPEN','DELAYED_BY_SUPPLIER') AND expected_arrival<=? ORDER BY expected_arrival, po_id`)
    .all(date) as Po[];
  for (const p of due) {
    const it = items.find((i) => i.item_id === p.item_id) as Item;
    const expiry = it.shelf_life_days ? addDays(date, it.shelf_life_days) : null;
    const sp = it.space_m2_per_unit;
    // Receiving respects zone capacity: home zone first, general goods from Z1 overflow into Z5, the rest waits at the supplier.
    const homeRoom = Math.max(0, Math.floor(zoneRoom(it.zone_id) / sp + 1e-9));
    const inHome = Math.min(p.quantity, homeRoom);
    let inOver = 0;
    if (it.zone_id === "Z1" && p.quantity > inHome) inOver = Math.min(p.quantity - inHome, Math.max(0, Math.floor(zoneRoom("Z5") / sp + 1e-9)));
    const got = inHome + inOver;
    const rest = p.quantity - got;
    const lotId = (z: string) => {
      let id = `LOT-${p.item_id.slice(4)}-${p.po_id}${z === it.zone_id ? "" : "-" + z}`, n = 1;
      while (d.prepare(`SELECT 1 FROM current_stock WHERE lot_id=?`).get(id)) id = `${id.replace(/-r\d+$/, "")}-r${++n}`;
      return id;
    };
    if (inHome > 0) d.prepare(`INSERT INTO current_stock VALUES(?,?,?,?,?,?)`).run(lotId(it.zone_id), p.item_id, it.zone_id, inHome, date, expiry);
    if (inOver > 0) d.prepare(`INSERT INTO current_stock VALUES(?,?,?,?,?,?)`).run(lotId("Z5"), p.item_id, "Z5", inOver, date, expiry);
    if (got > 0) {
      addMovement(date, p.item_id, "IN", got, p.po_id);
      if (rest > 0) {
        // partial receipt: keep the budget value on the received row, re-schedule the remainder for tomorrow
        d.prepare(`UPDATE purchase_orders_open SET status='RECEIVED', received_date=?, quantity=? WHERE po_id=?`).run(date, got, p.po_id);
        const rid = `${p.po_id.replace(/-R\d+$/, "")}-R${(d.prepare(`SELECT COUNT(*) c FROM purchase_orders_open WHERE po_id LIKE ?`).get(p.po_id.replace(/-R\d+$/, "") + "-R%") as { c: number }).c + 1}`;
        d.prepare(`INSERT INTO purchase_orders_open VALUES(?,?,?,?,?,?,'OPEN',?,NULL)`).run(rid, p.item_id, p.supplier_id, rest, p.order_date, addDays(date, 1), p.source);
      } else d.prepare(`UPDATE purchase_orders_open SET status='RECEIVED', received_date=? WHERE po_id=?`).run(date, p.po_id);
      logEvent("PO_ARRIVED", p.item_id,
        `وصل أمر الشراء ${p.po_id}: +${fmt(got)} ${uAr(it.unit)} من ${it.name_ar}` +
          (inOver ? ` — ${fmt(inOver)} منها وُجّهت إلى منطقة الفائض Z5 لأن ${it.zone_id} ممتلئة` : "") +
          (rest ? ` — بقي ${fmt(rest)} لدى المورّد لعدم توفر مساحة (إعادة جدولة غداً)` : ""),
        `PO ${p.po_id} arrived: +${fmt(got)} ${it.unit} of ${it.name_en}` +
          (inOver ? ` — ${fmt(inOver)} sent to overflow zone Z5 because ${it.zone_id} is full` : "") +
          (rest ? ` — ${fmt(rest)} held at the supplier, no space (retry tomorrow)` : ""), inOver || rest ? "high" : "info");
    } else {
      // nothing fits: push to tomorrow, log once per PO
      d.prepare(`UPDATE purchase_orders_open SET expected_arrival=? WHERE po_id=?`).run(addDays(date, 1), p.po_id);
      if (!d.prepare(`SELECT 1 FROM events WHERE type='RECEIVING_BLOCKED' AND message_en LIKE ?`).get(`%${p.po_id}%`))
        logEvent("RECEIVING_BLOCKED", p.item_id, `تعذّر استلام ${p.po_id} (${it.name_ar}): لا توجد مساحة في ${it.zone_id}${it.zone_id === "Z1" ? " أو Z5" : ""} — إعادة المحاولة غداً`,
          `Cannot receive ${p.po_id} (${it.name_en}): no room in ${it.zone_id}${it.zone_id === "Z1" ? " or Z5" : ""} — retry tomorrow`, "high");
    }
  }

  // 3) Daily usage = baseline x seasonality/spike x seeded noise, issued FEFO.
  const base = new Map((d.prepare(`SELECT item_id, daily_base FROM sim_baseline`).all() as { item_id: string; daily_base: number }[]).map((b) => [b.item_id, b.daily_base]));
  for (const it of items) {
    const noise = 1 + (rand(`${seed}|${date}|${it.item_id}|n`) * 2 - 1) * NOISE;
    const want = stochRound((base.get(it.item_id) ?? 0) * demandMultiplier(it.item_id, date) * noise, rand(`${seed}|${date}|${it.item_id}|r`));
    if (want <= 0) continue;
    const before = totalOnHand(it.item_id);
    let take = Math.min(want, before); // stock never goes below zero
    const issued = take;
    if (take > 0) {
      const lots = d.prepare(`SELECT * FROM current_stock WHERE item_id=? AND quantity_on_hand>0 ORDER BY expiry_date IS NULL, expiry_date, received_date`).all(it.item_id) as Lot[];
      for (const l of lots) {
        if (take <= 0) break;
        const used = Math.min(take, l.quantity_on_hand);
        if (used >= l.quantity_on_hand) d.prepare(`DELETE FROM current_stock WHERE lot_id=?`).run(l.lot_id);
        else d.prepare(`UPDATE current_stock SET quantity_on_hand=quantity_on_hand-? WHERE lot_id=?`).run(used, l.lot_id);
        take -= used;
      }
      addMovement(date, it.item_id, "OUT", issued, "SALES/ISSUE");
    }
    if (issued < want || (before > 0 && before - issued <= 0)) {
      // one stock-out event per episode (until the next receipt)
      const lastIn = (d.prepare(`SELECT MAX(date) m FROM stock_movements WHERE item_id=? AND movement_type='IN' AND sim=1`).get(it.item_id) as { m: string | null }).m ?? "0000";
      const already = d.prepare(`SELECT 1 FROM events WHERE type='STOCKOUT' AND item_id=? AND sim_date>=?`).get(it.item_id, lastIn);
      if (!already || before > 0) {
        logEvent("STOCKOUT", it.item_id, `نفاد المخزون — توقف الإنتاج: ${it.name_ar} (${it.item_id})`,
          `Stockout – production stopped: ${it.name_en} (${it.item_id})`, "critical");
      }
    }
  }
}

export interface TickResult { sim_date: string; movements: unknown[]; events: unknown[] }

/** Advances the simulated clock by one day, writes the movements, then lets the Coordinator run the agents. */
export async function tick(): Promise<TickResult> {
  const d = db();
  const s = getSim();
  const items = getItems();
  const lastSeq = (d.prepare(`SELECT COALESCE(MAX(seq),0) m FROM stock_movements`).get() as { m: number }).m;
  const lastEvent = (d.prepare(`SELECT COALESCE(MAX(id),0) m FROM events`).get() as { m: number }).m;

  const next = addDays(s.sim_date, 1);
  d.transaction(() => {
    // close every day up to and including the current simulated date (covers the 2-day gap after the history ends)
    let day = s.processed_through;
    while (day < s.sim_date) {
      day = addDays(day, 1);
      processDay(day, s.seed, items);
    }
    d.prepare(`UPDATE sim_state SET sim_date=?, processed_through=? WHERE id=1`).run(next, s.sim_date);
  })();

  await runAll({ useLlm: false, group: `${next}#tick` });

  const movements = d.prepare(`SELECT m.seq, m.movement_id, m.date, m.item_id, i.name_ar, i.name_en, i.unit, m.movement_type, m.quantity,
    m.reference, m.balance_after FROM stock_movements m JOIN items i ON i.item_id=m.item_id WHERE m.seq>? ORDER BY m.seq`).all(lastSeq);
  const events = d.prepare(`SELECT * FROM events WHERE id>? ORDER BY id`).all(lastEvent);
  return { sim_date: next, movements, events };
}

export function setRunning(running: boolean) {
  db().prepare(`UPDATE sim_state SET running=? WHERE id=1`).run(running ? 1 : 0);
}
export function setSpeed(speed: number) {
  db().prepare(`UPDATE sim_state SET speed=? WHERE id=1`).run([1, 2, 5].includes(speed) ? speed : 1);
}

/** Restores the starting state (re-seeds from the CSV files) and re-runs the agents once. */
export async function resetSim() {
  const speed = getSim().speed;
  seedDatabase();
  setSpeed(speed);
  await runAll({ useLlm: false, group: "start" });
}
