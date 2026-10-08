import { db } from "../db";
import { getSim, M, type AgentResult, type Msg } from "../core";
import { loadSettings } from "../settings";
import { logSpaceEvent } from "./common";
import { projectZones, spacePlanAgent } from "./forecast";
import { evaluateOffer, getListing, listingAdvice, listingRest, type Offer } from "./market";

/**
 * Conflicts between rental and purchasing become alerts in BOTH flows (flow 'both'): a published listing the company's own approved
 * orders now squeeze, and offers waiting for an answer that the company now needs the space for.
 */
export function syncSpaceConflicts() {
  const d = db();
  const sim = getSim();
  const cfg = loadSettings();
  const seen = new Set<string>();
  const rows = d.prepare(`SELECT * FROM space_forecasts WHERE state='CONFLICT' ORDER BY id`).all() as { zone_id: string; start_date: string; end_date: string; area: number; inputs: string }[];
  const put = (key: string, kind: string, severity: string, title: Msg, detail: Msg[], ignore: Msg | null, poRef: string | null, flow: "both" | "space" = "both") => {
    seen.add(key);
    const ex = d.prepare(`SELECT active FROM alerts WHERE key=?`).get(key) as { active: number } | undefined;
    if (!ex) {
      d.prepare(`INSERT INTO alerts(key,kind,item_id,severity,title,detail,ignore_msg,rec_key,active,first_tick,updated_tick,flow) VALUES(?,?,NULL,?,?,?,?,NULL,1,?,?,?)`)
        .run(key, kind, severity, JSON.stringify(title), JSON.stringify(detail), ignore ? JSON.stringify(ignore) : null, sim.tick, sim.tick, flow);
    } else {
      d.prepare(`UPDATE alerts SET severity=?,title=?,detail=?,ignore_msg=?,active=1,updated_tick=?,first_tick=CASE WHEN active=0 THEN ? ELSE first_tick END WHERE key=?`)
        .run(severity, JSON.stringify(title), JSON.stringify(detail), ignore ? JSON.stringify(ignore) : null, sim.tick, sim.tick, key);
    }
    if (!ex || !ex.active) logSpaceEvent(flow === "both" ? "SPACE_CONFLICT" : "SPACE_ADVICE", title, flow === "both" ? "high" : "info", { flow, ref: key, meta: { po: poRef } });
  };
  for (const r of rows) {
    const inp = JSON.parse(r.inputs) as { listing_id: number; rest: number; ok_area: number; driver: { po_id: string; item_id: string; qty: number; area: number; arrival: string } | null };
    const dr = inp.driver;
    put(`CONFLICT:LISTING:${inp.listing_id}`, "LISTING_RISK", "High",
      M("alert.sp.listing_risk.title", { zone: r.zone_id, short: r.area, listing: inp.rest }),
      [M("alert.sp.listing_risk.d1", { po: dr?.po_id ?? "", item: dr?.item_id ?? "", qty: dr?.qty ?? 0, area: dr?.area ?? 0, arrival: dr?.arrival ?? "", from: r.start_date, to: r.end_date, ok: inp.ok_area, listing: inp.rest })],
      M("alert.sp.listing_risk.ignore", { short: r.area }), dr?.po_id ?? null);
  }
  // a rental has started (or is about to) in a zone where our own stock still fills the space: never cancelled, but flagged in both flows
  for (const z of d.prepare(`SELECT w.zone_id, w.capacity_m2 c, w.fixed_occupied_m2_aisles_equipment f,
      COALESCE((SELECT SUM(x.quantity_on_hand*i.space_m2_per_unit) FROM current_stock x JOIN items i ON i.item_id=x.item_id WHERE x.zone_id=w.zone_id),0) st,
      COALESCE((SELECT SUM(area) FROM space_leases WHERE zone_id=w.zone_id AND status IN ('RESERVED','ACTIVE') AND start_date<=? AND ?<end_date),0) ls FROM warehouse_zones w`).all(sim.sim_date, sim.sim_date) as { zone_id: string; c: number; f: number; st: number; ls: number }[]) {
    if (z.ls > 0 && z.f + z.st + z.ls > z.c + 1e-6)
      put(`LEASE_OVER:${z.zone_id}`, "LEASE_OVER", "High", M("alert.sp.lease_over.title", { zone: z.zone_id, over: z.f + z.st + z.ls - z.c }),
        [M("alert.sp.lease_over.d1", { zone: z.zone_id, leased: z.ls, stock: z.f + z.st, capacity: z.c })], M("alert.sp.lease_over.ignore", { zone: z.zone_id }), null);
  }
  // a listing nobody answered within the window: a suggestion (lower the price, widen dates or area, split)
  for (const a of listingAdvice(cfg))
    put(`NO_OFFERS:${a.listing_id}`, "NO_OFFERS", "Monitor", M("alert.sp.no_offers.title", { zone: a.zone_id, days: cfg.n("space.offer_window_days") }),
      [M(a.high ? "alert.sp.no_offers.d_high" : "alert.sp.no_offers.d1", { price: a.price, market: a.market, suggest: a.suggest_price })], M("alert.sp.no_offers.ignore"), null, "space");
  // offers waiting for an answer: is the space still free? (a purchase approved meanwhile can take it)
  const lstProj = new Map<number, ReturnType<typeof projectZones>>();
  for (const o of d.prepare(`SELECT * FROM space_offers WHERE status='PENDING' ORDER BY id`).all() as Offer[]) {
    const l = getListing(o.listing_id);
    if (!l) continue;
    if (!lstProj.has(l.id)) lstProj.set(l.id, projectZones(cfg, { excludeListing: l.id }));
    const ev = evaluateOffer(cfg, o, l, lstProj.get(l.id));
    // "now needed" only for offers that would otherwise be acceptable (the area fits the listing)
    const bad = o.area <= listingRest(l) + 1e-6 ? ev.checks.find((c) => c.key === "needs" && c.level === "bad") : undefined;
    if (bad && o.flag !== "COMPANY_NEEDS") {
      d.prepare(`UPDATE space_offers SET flag='COMPANY_NEEDS' WHERE id=?`).run(o.id);
      logSpaceEvent("OFFER_BLOCKED", M("ev.sp.offer_blocked", { company: o.company, area: o.area }), "high", { flow: "both", ref: String(o.id), meta: { po: (bad.msg.v as { po?: string } | undefined)?.po ?? null } });
    } else if (!bad && o.flag) d.prepare(`UPDATE space_offers SET flag=NULL WHERE id=?`).run(o.id);
  }
  for (const a of d.prepare(`SELECT key FROM alerts WHERE kind IN ('LISTING_RISK','LEASE_OVER','NO_OFFERS') AND active=1`).all() as { key: string }[]) {
    if (!seen.has(a.key)) d.prepare(`UPDATE alerts SET active=0, updated_tick=? WHERE key=?`).run(sim.tick, a.key);
  }
}

/** Agent 6 (REASON): Space Forecast. Windows of space the company will not need, blocked periods, and conflicts with purchasing. */
export function spacePlan(group: string, trigger: string): AgentResult {
  const r = spacePlanAgent(group, trigger);
  syncSpaceConflicts();
  return r;
}
void M;
