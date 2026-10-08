import { db } from "../db";
import { clockAt } from "../clock";
import { getSim, M, type Msg } from "../core";
import { loadSettings } from "../settings";
import { dailyIncome } from "../calc";

export interface SpaceImpactRow { id: number; tick: number; kind: string; decision: string; head: Msg; effects: Msg[]; state: "effect" | "pending" | "none"; flow: "space"; item_id: null; request_id: null }

/** Impact texts of listing decisions by action (head, effect). */
const LISTING_KEYS: Record<string, [string, string]> = {
  PAUSE: ["impact.sp.head.listing_pause", "impact.sp.e.listing_pause"], RESUME: ["impact.sp.head.listing_resume", "impact.sp.e.listing_resume"],
  WITHDRAW: ["impact.sp.head.listing_withdraw", "impact.sp.e.listing_withdraw"], SHRINK: ["impact.sp.head.listing_shrink", "impact.sp.e.listing_shrink"],
};

const all = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).all(...a) as T[];
const one = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).get(...a) as T | undefined;

/**
 * Impact log of the space flow: each decision with what followed, read from offers, leases and events (never written by hand).
 * Example: "You listed an area on a date -> an offer from X arrived on 11 Oct 15:00 -> you accepted it -> 500 m² is leased from 1 Nov and income is 4.000 OMR per day".
 */
export function spaceImpact(limit = 60): SpaceImpactRow[] {
  const sim = getSim();
  const cfg = loadSettings();
  const dpm = cfg.n("space.days_per_month");
  const when = (tick: number) => { const c = clockAt(sim.start_date, tick); return `${c.date}|${c.hour}`; };
  const rows = all(`SELECT * FROM space_decisions ORDER BY tick DESC, id DESC LIMIT ?`, limit);
  return rows.map((r): SpaceImpactRow => {
    const d = JSON.parse(r.detail ?? "{}");
    const effects: Msg[] = [];
    let head: Msg;
    let state: SpaceImpactRow["state"] = "effect";
    const w = when(r.tick);
    const leaseEffects = (leaseId: number | null) => {
      const l = leaseId ? one(`SELECT * FROM space_leases WHERE id=?`, leaseId) : undefined;
      if (!l) return;
      effects.push(M("impact.sp.e.lease", { area: l.area, zone: l.zone_id, start: l.start_date, end: l.end_date, perday: dailyIncome(l.area, l.price, dpm), company: l.company }));
      if (l.status === "ACTIVE" || l.status === "ENDED") effects.push(M("impact.sp.e.lease_started", { income: l.income, days: l.income_days }));
      if (l.status === "ENDED") effects.push(M("impact.sp.e.lease_ended", { when: when(l.ended_tick ?? sim.tick), area: l.area, zone: l.zone_id }));
    };

    if (r.kind === "LISTING" && (r.action === "PUBLISH" || r.action === "DRAFT")) {
      head = M(r.action === "PUBLISH" ? "impact.sp.head.listed" : "impact.sp.head.drafted", { area: d.area, zone: r.zone_id, when: w, price: d.price, start: d.start, end: d.end });
      if (r.action === "DRAFT") { state = "none"; effects.push(M("impact.sp.e.draft")); }
      else {
        const offers = all(`SELECT * FROM space_offers WHERE listing_id=? ORDER BY arrived_tick, id`, r.listing_id);
        if (!offers.length) { state = "pending"; effects.push(M("impact.sp.e.no_offers")); }
        for (const o of offers) {
          effects.push(M("impact.sp.e.offer", { company: o.company, when: when(o.arrived_tick), area: o.area, price: o.price }));
          if (o.status === "ACCEPTED") { effects.push(M("impact.sp.e.accepted", { company: o.company })); leaseEffects(one(`SELECT id FROM space_leases WHERE offer_id=?`, o.id)?.id ?? null); }
          else if (o.status === "REJECTED") effects.push(M("impact.sp.e.rejected", { company: o.company }));
          else if (o.status === "EXPIRED") effects.push(M("impact.sp.e.expired", { company: o.company }));
          else if (o.status === "COUNTERED") effects.push(M("impact.sp.e.countered_wait", { company: o.company }));
          else if (o.status === "DECLINED") effects.push(M("impact.sp.e.declined", { company: o.company }));
          else if (o.status === "PENDING") effects.push(M("impact.sp.e.waiting", { company: o.company }));
        }
        for (const e of all(`SELECT tick, meta FROM events WHERE type='SPACE_CONFLICT' AND ref=? ORDER BY tick LIMIT 2`, `CONFLICT:LISTING:${r.listing_id}`)) {
          const m = e.meta ? JSON.parse(e.meta) : {};
          effects.push(M("impact.sp.e.conflict", { when: when(e.tick), po: m.po ?? "" }));
        }
      }
    } else if (r.kind === "KEEP_VACANT") {
      head = M("impact.sp.head.vacant", { area: d.area, zone: r.zone_id, when: w, until: r.reeval_date });
      effects.push(M("impact.sp.e.vacant_income"));
      effects.push(M(r.reeval_date <= sim.sim_date ? "impact.sp.e.vacant_checked" : "impact.sp.e.vacant_check", { until: r.reeval_date }));
    } else if (r.kind === "OFFER" && r.action === "ACCEPT") {
      head = M("impact.sp.head.accepted", { company: d.company, area: d.area, zone: r.zone_id, when: w });
      leaseEffects(r.lease_id);
      effects.push(M("impact.sp.e.purchasing_sees"));
    } else if (r.kind === "OFFER" && r.action === "REJECT") {
      head = M("impact.sp.head.rejected", { company: d.company, area: d.area, when: w });
      effects.push(M("impact.sp.e.not_shown"));
    } else if (r.kind === "OFFER" && r.action === "COUNTER") {
      head = M("impact.sp.head.countered", { company: d.company, when: w, area: d.to.area, price: d.to.price });
      const o = one(`SELECT status FROM space_offers WHERE id=?`, r.offer_id);
      if (o?.status === "COUNTERED") { state = "pending"; effects.push(M("impact.sp.e.counter_wait", { when: when(d.answer_tick) })); }
      else if (o?.status === "ACCEPTED") { effects.push(M("impact.sp.e.counter_yes", { company: d.company })); leaseEffects(one(`SELECT id FROM space_leases WHERE offer_id=?`, r.offer_id)?.id ?? null); }
      else effects.push(M("impact.sp.e.counter_no", { company: d.company }));
    } else if (r.kind === "OFFER") {
      // the company's answer to a counter-offer
      head = M(r.action === "COUNTER_ACCEPTED" ? "impact.sp.head.counter_yes" : "impact.sp.head.counter_no", { company: d.company, when: w });
      if (r.action === "COUNTER_ACCEPTED") leaseEffects(r.lease_id); else state = "none";
    } else if (r.kind === "LISTING") {
      const key = LISTING_KEYS[r.action];
      head = key ? M(key[0], { zone: r.zone_id, when: w, area: d.area }) : M("impact.head.generic", { kind: r.kind, when: w });
      if (key) effects.push(M(key[1]));
    } else { head = M("impact.head.generic", { kind: r.kind, when: w }); state = "none"; }
    return { id: r.id, tick: r.tick, kind: r.kind, decision: r.action, head, effects, state, flow: "space", item_id: null, request_id: null };
  });
}
