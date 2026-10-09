import { db } from "../db";
import { getSim, M, UserError, type Msg } from "../core";
import type { Settings } from "../settings";
import type { MarketCfg, WindowCfg } from "../calc";

export type Flow = "purchasing" | "space" | "both";

/** Event of the space flow (tagged with its flow so each section has its own activity feed). */
export function logSpaceEvent(type: string, msg: Msg, severity: string, o: { ref?: string; actor?: string; meta?: unknown; flow?: Flow } = {}) {
  const s = getSim();
  db().prepare(`INSERT INTO events(tick,ts,sim_date,type,item_id,severity,msg,ref,actor,meta,flow) VALUES(?,?,?,?,NULL,?,?,?,?,?,?)`)
    .run(s.tick, new Date().toISOString(), s.sim_date, type, severity, JSON.stringify(msg), o.ref ?? null, o.actor ?? "system",
      o.meta === undefined ? null : JSON.stringify(o.meta), o.flow ?? "space");
}

/** Audit row of a space decision (always stamped with the simulated time). */
export function spaceDecision(kind: string, action: string, o: { zone?: string | null; listing?: number | null; offer?: number | null; lease?: number | null; reeval?: string | null; reason?: string | null; detail?: unknown }): number {
  const s = getSim();
  return db().prepare(`INSERT INTO space_decisions(tick,ts,kind,action,zone_id,listing_id,offer_id,lease_id,reeval_date,reason,detail) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(s.tick, new Date().toISOString(), kind, action, o.zone ?? null, o.listing ?? null, o.offer ?? null, o.lease ?? null, o.reeval ?? null, o.reason ?? null, JSON.stringify(o.detail ?? {})).lastInsertRowid as number;
}

export const windowCfg = (cfg: Settings): WindowCfg => ({
  minBlock: cfg.n("space.min_block_m2"), minDays: cfg.n("space.min_lease_days"), step: cfg.n("space.area_step_m2"), maxLayers: cfg.n("space.max_layers"), startBuffer: cfg.n("space.start_buffer_days"),
});
export const marketCfg = (cfg: Settings): MarketCfg => ({
  market: cfg.n("space.price_market"), bandPct: cfg.n("space.price_band_pct"), baseProb: cfg.n("space.offer_base_prob"),
  sensitivity: cfg.n("space.price_sensitivity"), delayMin: cfg.n("space.offer_delay_min_h"), delayMax: cfg.n("space.offer_delay_max_h"),
});

/** Space decisions waiting for the manager: new free-space windows, conflicts and offers (used by "Next event"). */
export const spaceDecisionsWaiting = (): number =>
  (db().prepare(`SELECT (SELECT COUNT(*) FROM space_forecasts WHERE state IN ('NEW','CONFLICT')) + (SELECT COUNT(*) FROM space_offers WHERE status='PENDING') n`).get() as { n: number }).n;

/** A refused action with a message the UI shows in the user's language. */
export class SpaceError extends UserError {}
export { M };
