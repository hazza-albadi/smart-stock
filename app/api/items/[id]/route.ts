import { handle } from "@/lib/api";
import { db } from "@/lib/db";
import { addDays } from "@/lib/time";
import { getSim } from "@/lib/core";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handle(() => {
    const d = db();
    const end = getSim().data_end;
    const weekly: number[] = [];
    for (let w = 25; w >= 0; w--) {
      const to = addDays(end, -7 * w), from = addDays(to, -6);
      weekly.push((d.prepare(`SELECT COALESCE(SUM(quantity),0) q FROM stock_movements WHERE item_id=? AND movement_type='OUT' AND reference!='EXPIRED' AND date BETWEEN ? AND ?`).get(id, from, to) as { q: number }).q);
    }
    return {
      weekly, forecast: d.prepare(`SELECT * FROM forecasts WHERE item_id=?`).get(id),
      lots: d.prepare(`SELECT * FROM current_stock WHERE item_id=? AND quantity_on_hand>0 ORDER BY expiry_date IS NULL, expiry_date`).all(id),
      pos: d.prepare(`SELECT * FROM purchase_orders_open WHERE item_id=? ORDER BY expected_arrival DESC LIMIT 6`).all(id),
      movements: d.prepare(`SELECT date, tick, movement_type, quantity, reference, balance_after FROM stock_movements WHERE item_id=? ORDER BY seq DESC LIMIT 10`).all(id),
    };
  });
}
