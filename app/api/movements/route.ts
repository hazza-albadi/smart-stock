import { handle } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => handle(() => {
  const u = new URL(req.url);
  const before = Number(u.searchParams.get("before") ?? 1e12), limit = Math.min(200, Number(u.searchParams.get("limit") ?? 60));
  return db().prepare(`SELECT m.seq, m.date, m.tick, m.item_id, i.unit, m.movement_type, m.quantity, m.reference, m.balance_after, m.lot_id, m.actor
    FROM stock_movements m JOIN items i ON i.item_id=m.item_id WHERE +m.sim=1 AND m.seq<? ORDER BY m.seq DESC LIMIT ?`).all(before, limit);
});
