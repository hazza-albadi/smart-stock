import { NextResponse } from "next/server";
import { ensureSeeded } from "@/lib/ensure";
import { db } from "@/lib/db";
import { addDays } from "@/lib/time";
import { getSim } from "@/lib/core";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await ensureSeeded();
  const { id } = await ctx.params;
  const d = db();
  const sim = getSim();
  const end = sim.processed_through;
  const weekly: number[] = [];
  for (let w = 25; w >= 0; w--) {
    const to = addDays(end, -7 * w);
    const from = addDays(to, -6);
    weekly.push((d.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM stock_movements WHERE item_id=? AND movement_type='OUT' AND reference!='EXPIRED' AND date BETWEEN ? AND ?`).get(id, from, to) as { q: number }).q);
  }
  return NextResponse.json({
    weekly,
    forecast: d.prepare(`SELECT * FROM forecasts WHERE item_id=?`).get(id),
    lots: d.prepare(`SELECT * FROM current_stock WHERE item_id=? AND quantity_on_hand>0 ORDER BY expiry_date IS NULL, expiry_date`).all(id),
    pos: d.prepare(`SELECT * FROM purchase_orders_open WHERE item_id=? ORDER BY expected_arrival DESC LIMIT 5`).all(id),
    movements: d.prepare(`SELECT date, movement_type, quantity, reference, balance_after FROM stock_movements WHERE item_id=? ORDER BY seq DESC LIMIT 8`).all(id),
  });
}
