import { db } from "./db";
import type { Settings } from "./settings";
import type { Item, Lot, Po, ForecastRow } from "./core";
import { coverWeeks, projectStockout, usableQty, type DemandModel, type Now, type Stockout, type SeasonCfg } from "./calc";

export interface Live {
  item: Item; fc: ForecastRow | null; model: DemandModel; lots: Lot[]; pos: Po[]; onHand: number; usable: number;
  weeklyUsage: number; cover: number; stockout: Stockout | null;
}

export const openPos = () => db().prepare(`SELECT * FROM purchase_orders_open WHERE status IN ('OPEN','DELAYED_BY_SUPPLIER') ORDER BY expected_arrival, expected_hour`).all() as Po[];

/** Live per-item state computed from the tables right now: stock is always live, demand parameters come from the forecast agent. */
export function loadLive(cfg: Settings, now: Now): Map<string, Live> {
  const d = db();
  const items = d.prepare(`SELECT * FROM items ORDER BY item_id`).all() as Item[];
  const fcs = new Map((d.prepare(`SELECT * FROM forecasts`).all() as ForecastRow[]).map((f) => [f.item_id, f]));
  const lots = d.prepare(`SELECT * FROM current_stock WHERE quantity_on_hand>0 ORDER BY expiry_date IS NULL, expiry_date, received_date`).all() as Lot[];
  const pos = openPos();
  const season = cfg.j<SeasonCfg>("demand.season");
  const out = new Map<string, Live>();
  for (const it of items) {
    const fc = fcs.get(it.item_id) ?? null;
    const model: DemandModel = { itemId: it.item_id, baseWeekly: fc?.base_weekly ?? 0, season };
    const myLots = lots.filter((l) => l.item_id === it.item_id);
    const myPos = pos.filter((p) => p.item_id === it.item_id);
    const onHand = myLots.reduce((a, l) => a + l.quantity_on_hand, 0);
    const usable = usableQty(model, now, myLots, cfg.n("expiry.last_usable_hour"));
    const weekly = fc?.weekly_usage ?? 0;
    out.set(it.item_id, {
      item: it, fc, model, lots: myLots, pos: myPos, onHand, usable, weeklyUsage: weekly, cover: coverWeeks(onHand, weekly),
      stockout: projectStockout(model, now, usable, myPos, cfg.n("forecast.projection_days")),
    });
  }
  return out;
}
