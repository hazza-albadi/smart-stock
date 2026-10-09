import { db } from "../db";
import { addDays, addMonths, diffDays } from "../time";
import { clockAt } from "../clock";
import { rand } from "../rng";
import { arrivalDelayHours, arrivalProbability, counterAcceptProbability, dailyIncome, tenantBid } from "../calc";
import { getSim, M, type Msg } from "../core";
import { loadSettings, type Settings } from "../settings";
import { marketCfg, logSpaceEvent, spaceDecision, SpaceError } from "./common";
import { maxListable, minOver, projectZones, rawFree, type ZoneProj } from "./forecast";
import { createSpaceDraft, dropDrafts } from "../drafts";

export interface Listing { guaranteed: number; window_tick: number | null; id: number; zone_id: string; area: number; start_date: string; end_date: string; price: number; status: string; created_tick: number; published_tick: number | null; resumed_tick: number | null; closed_tick: number | null; note: string | null }
export interface Offer {
  id: number; listing_id: number; request_id: string; company: string; area: number; start_date: string; end_date: string; price: number; status: string;
  arrived_tick: number; valid_until_tick: number; decided_tick: number | null; reason: string | null; counter: string | null; counter_due_tick: number | null; counter_n: number; flag: string | null;
}
export interface Lease { id: number; offer_id: number; listing_id: number; request_id: string; company: string; zone_id: string; area: number; start_date: string; end_date: string; price: number; status: string; signed_tick: number; ended_tick: number | null; income: number; income_days: number }
interface Pool { request_id: string; company: string; required_storage_type: string; area_needed_m2: number; duration_months: number; needed_from: string; price_factor: number; source: string }

const all = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).all(...a) as T[];
const one = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).get(...a) as T | undefined;
const dateOf = (tick: number) => clockAt(getSim().start_date, tick).date;

/** A rental never starts in the past: the earliest start is tomorrow (the offer's own start date when it is later). */
const effectiveStart = (start: string, today: string) => (start <= today ? addDays(today, 1) : start);

export const getListing = (id: number) => one<Listing>(`SELECT * FROM space_listings WHERE id=?`, id);
export const getOffer = (id: number) => one<Offer>(`SELECT * FROM space_offers WHERE id=?`, id);

/** Area of a listing still on offer: its area minus what has been leased from it. */
export const listingRest = (l: Listing) =>
  Math.max(0, l.area - (one<{ a: number }>(`SELECT COALESCE(SUM(area),0) a FROM space_leases WHERE listing_id=?`, l.id)?.a ?? 0));

// ---------------------------------------------------------------- offer evaluation
export type CheckLevel = "ok" | "warn" | "bad";
export interface Check { key: "type" | "area" | "dates" | "duration" | "price" | "needs"; level: CheckLevel; msg: Msg }
export interface OfferEval { checks: Check[]; can_accept: boolean; blockers: string[]; suggest: { area: number; start: string; end: string; price: number } | null }

/** Automatic checks of an offer against the listing and the latest forecast (company need, approved orders, signed leases). */
export function evaluateOffer(cfg: Settings, o: Pick<Offer, "request_id" | "area" | "start_date" | "end_date" | "price">, l: Listing, proj?: Map<string, ZoneProj>): OfferEval {
  const p = (proj ?? projectZones(cfg, { excludeListing: l.id })).get(l.zone_id);
  o = { ...o, start_date: effectiveStart(o.start_date, getSim().sim_date) };
  const req = one<Pool>(`SELECT * FROM space_requests WHERE request_id=?`, o.request_id);
  const rest = listingRest(l);
  const checks: Check[] = [];
  const typeOk = !!req && req.required_storage_type === cfg.s("space.rentable_request_type");
  checks.push({ key: "type", level: typeOk ? "ok" : "bad", msg: M(typeOk ? "sp.chk.type_ok" : "sp.chk.type_bad", { zone: l.zone_id }) });
  checks.push({ key: "area", level: o.area <= rest + 1e-6 ? "ok" : "bad", msg: M(o.area <= rest + 1e-6 ? "sp.chk.area_ok" : "sp.chk.area_bad", { asked: o.area, offered: rest }) });
  const inside = o.start_date >= l.start_date && o.end_date <= l.end_date;
  checks.push({ key: "dates", level: inside ? "ok" : "warn", msg: M(inside ? "sp.chk.dates_ok" : "sp.chk.dates_out", { from: l.start_date, to: l.end_date }) });
  const days = diffDays(o.end_date, o.start_date), minDays = cfg.n("space.min_lease_days");
  checks.push({ key: "duration", level: days >= minDays ? "ok" : "bad", msg: M(days >= minDays ? "sp.chk.duration_ok" : "sp.chk.duration_bad", { days, min: minDays }) });
  const pl = o.price >= l.price - 1e-9 ? "ok" : o.price >= l.price * 0.9 ? "warn" : "bad";
  checks.push({ key: "price", level: pl === "bad" ? "warn" : pl, msg: M(o.price >= l.price - 1e-9 ? "sp.chk.price_ok" : "sp.chk.price_low", { offer: o.price, listing: l.price }) });
  let free = 0, firstShort: string | null = null;
  if (p) {
    free = Math.max(0, Math.floor(minOver(p, o.start_date, o.end_date, (k) => rawFree(p, k) - p.listed[k])));
    for (let dt = o.start_date; dt < o.end_date; dt = addDays(dt, 1)) {
      const k = Math.min(p.dates.length - 1, Math.max(0, diffDays(dt, p.dates[0])));
      if (rawFree(p, k) - p.listed[k] < o.area) { firstShort = dt; break; }
    }
  }
  const needsOk = free + 1e-6 >= o.area;
  const drv = !needsOk && p ? p.drivers.find((x) => !x.pending && x.arrival < o.end_date) : undefined;
  checks.push({ key: "needs", level: needsOk ? "ok" : "bad", msg: needsOk ? M("sp.chk.needs_ok") : M(drv ? "sp.chk.needs_po" : "sp.chk.needs_bad", { free, date: firstShort ?? o.start_date, po: drv?.po_id ?? "", item: drv?.item_id ?? "", area: drv?.area ?? 0, arrival: drv?.arrival ?? "" }) });
  const blockers = checks.filter((c) => c.level === "bad").map((c) => c.key);
  const feasible = Math.max(0, Math.min(rest, free));
  const start = o.start_date < l.start_date ? l.start_date : o.start_date, end = o.end_date > l.end_date ? l.end_date : o.end_date;
  const useWindow = diffDays(end, start) >= minDays;
  const suggest = blockers.length && feasible >= cfg.n("space.min_block_m2") ? {
    area: Math.floor(feasible / cfg.n("space.area_step_m2")) * cfg.n("space.area_step_m2") || feasible, start: useWindow ? start : o.start_date, end: useWindow ? end : o.end_date, price: Math.max(o.price, l.price),
  } : null;
  return { checks, can_accept: blockers.length === 0, blockers, suggest };
}

/** The reason given to the company: the first automatic check that failed (or warned), else the manager's own reason. */
function replyReason(ev: OfferEval, fallback: Msg | null, prefer?: string): Msg | null {
  const named = prefer ? ev.checks.find((x) => x.key === prefer && x.level !== "ok") : undefined;
  const c = named ?? ev.checks.find((x) => x.level === "bad") ?? ev.checks.find((x) => x.level === "warn");
  return c ? c.msg : fallback;
}

// ---------------------------------------------------------------- leases
function createLease(o: Offer, l: Listing, tick: number, terms: { area: number; start_date: string; end_date: string; price: number }): number {
  const d = db();
  const today = dateOf(tick);
  terms = { ...terms, start_date: effectiveStart(terms.start_date, today) };
  if (diffDays(terms.end_date, terms.start_date) < loadSettings().n("space.min_lease_days")) throw new SpaceError(M("sp.err.bad_terms"));
  const id = d.prepare(`INSERT INTO space_leases(offer_id,listing_id,request_id,company,zone_id,area,start_date,end_date,price,status,signed_tick,income,income_days) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,0)`)
    .run(o.id, l.id, o.request_id, o.company, l.zone_id, terms.area, terms.start_date, terms.end_date, terms.price, terms.start_date <= today ? "ACTIVE" : "RESERVED", tick).lastInsertRowid as number;
  // the company has found its space: its other open offers are closed; a fully leased listing is closed
  d.prepare(`UPDATE space_offers SET status='CLOSED', decided_tick=?, reason='taken' WHERE request_id=? AND id<>? AND status IN ('PENDING','COUNTERED')`).run(tick, o.request_id, o.id);
  d.prepare(`DELETE FROM space_offers WHERE request_id=? AND id<>? AND status='SCHEDULED'`).run(o.request_id, o.id);
  if (listingRest(l) <= 1e-6) d.prepare(`UPDATE space_listings SET status='LEASED', closed_tick=? WHERE id=?`).run(tick, l.id);
  return id;
}

/** Manager accepts an offer: re-checked against the latest forecast inside one transaction, then a lease is signed. */
export function acceptOffer(offerId: number): { decisionId: number; leaseId: number } {
  const d = db();
  const cfg = loadSettings();
  const s = getSim();
  let out = { decisionId: 0, leaseId: 0 };
  d.transaction(() => {
    const o = getOffer(offerId);
    if (!o || o.status !== "PENDING") throw new SpaceError(M("sp.err.offer_closed"));
    const l = getListing(o.listing_id) as Listing;
    if (!["PUBLISHED", "PAUSED"].includes(l.status)) throw new SpaceError(M("sp.err.listing_closed"));
    const ev = evaluateOffer(cfg, o, l);
    if (!ev.can_accept) throw new SpaceError(M("sp.err.cannot_accept", { why: ev.checks.filter((c) => c.level === "bad")[0]?.msg ?? null, area: ev.suggest?.area ?? 0 }));
    const leaseId = createLease(o, l, s.tick, o);
    d.prepare(`UPDATE space_offers SET status='ACCEPTED', decided_tick=? WHERE id=?`).run(s.tick, o.id);
    const decisionId = spaceDecision("OFFER", "ACCEPT", { zone: l.zone_id, listing: l.id, offer: o.id, lease: leaseId, detail: { area: o.area, start: o.start_date, end: o.end_date, price: o.price, company: o.company, per_day: dailyIncome(o.area, o.price, cfg.n("space.days_per_month")) } });
    logSpaceEvent("OFFER_ACCEPTED", M("ev.sp.accepted", { company: o.company, area: o.area, zone: l.zone_id, start: o.start_date, end: o.end_date }), "info", { actor: "user", ref: String(o.id) });
    createSpaceDraft({ action: "accept", decisionId, company: o.company, zone: l.zone_id, area: o.area, start: o.start_date, end: o.end_date, price: o.price, leaseId });
    out = { decisionId, leaseId };
  })();
  return out;
}

export const REJECT_REASONS = ["price", "dates", "area", "need", "other"] as const;
export function rejectOffer(offerId: number, reason: string): { decisionId: number } {
  const d = db();
  const s = getSim();
  const r = (REJECT_REASONS as readonly string[]).includes(reason) ? reason : "other";
  let decisionId = 0;
  d.transaction(() => {
    const o = getOffer(offerId);
    if (!o || o.status !== "PENDING") throw new SpaceError(M("sp.err.offer_closed"));
    d.prepare(`UPDATE space_offers SET status='REJECTED', decided_tick=?, reason=? WHERE id=?`).run(s.tick, r, o.id);
    const l = getListing(o.listing_id) as Listing;
    decisionId = spaceDecision("OFFER", "REJECT", { zone: l.zone_id, listing: l.id, offer: o.id, reason: r, detail: { company: o.company, area: o.area } });
    createSpaceDraft({ action: "reject", decisionId, company: o.company, zone: l.zone_id, area: o.area, start: o.start_date, end: o.end_date, price: o.price, why: replyReason(evaluateOffer(loadSettings(), o, l), M(`sp.reject.${r}`), ({ price: "price", dates: "dates", area: "area", need: "needs" } as Record<string, string>)[r]) });
    logSpaceEvent("OFFER_REJECTED", M("ev.sp.rejected", { company: o.company, area: o.area }), "info", { actor: "user", ref: String(o.id) });
  })();
  return { decisionId };
}

export interface Terms { area: number; start_date: string; end_date: string; price: number }
export function counterOffer(offerId: number, t: Terms): { decisionId: number } {
  const d = db();
  const cfg = loadSettings();
  const s = getSim();
  let decisionId = 0;
  d.transaction(() => {
    const o = getOffer(offerId);
    if (!o || o.status !== "PENDING") throw new SpaceError(M("sp.err.offer_closed"));
    const l = getListing(o.listing_id) as Listing;
    if (!(t.area > 0) || !(t.price > 0) || !(t.start_date < t.end_date)) throw new SpaceError(M("sp.err.bad_terms"));
    const ev = evaluateOffer(cfg, { ...o, ...t }, l);
    if (!ev.can_accept) throw new SpaceError(M("sp.err.cannot_accept", { why: ev.checks.filter((c) => c.level === "bad")[0]?.msg ?? null, area: ev.suggest?.area ?? 0 }));
    const seed = cfg.n("sim.seed");
    const n = o.counter_n + 1;
    const delay = Math.round(cfg.n("space.counter_delay_min_h") + rand(`${seed}|cdelay|${o.id}|${n}`) * (cfg.n("space.counter_delay_max_h") - cfg.n("space.counter_delay_min_h")));
    d.prepare(`UPDATE space_offers SET status='COUNTERED', counter=?, counter_due_tick=?, counter_n=?, decided_tick=? WHERE id=?`).run(JSON.stringify(t), s.tick + delay, n, s.tick, o.id);
    decisionId = spaceDecision("OFFER", "COUNTER", { zone: l.zone_id, listing: l.id, offer: o.id, detail: { company: o.company, from: { area: o.area, start: o.start_date, end: o.end_date, price: o.price }, to: t, answer_tick: s.tick + delay } });
    logSpaceEvent("OFFER_COUNTERED", M("ev.sp.countered", { company: o.company, area: t.area, price: t.price }), "info", { actor: "user", ref: String(o.id) });
    createSpaceDraft({ action: "counter", decisionId, company: o.company, zone: l.zone_id, area: o.area, start: o.start_date, end: o.end_date, price: o.price, counter: { area: t.area, start: t.start_date, end: t.end_date, price: t.price }, why: replyReason(evaluateOffer(cfg, o, l), null) });
  })();
  return { decisionId };
}

// ---------------------------------------------------------------- listings
export interface ListInput { zone_id: string; area: number; start_date: string; end_date: string; price: number; publish: boolean }

/** Creates a listing. Refused when the forecast says the company needs the space in that period. */
export function createListing(i: ListInput): { listingId: number; decisionId: number } {
  const d = db();
  const cfg = loadSettings();
  const s = getSim();
  let out = { listingId: 0, decisionId: 0 };
  d.transaction(() => {
    const z = one<{ zone_id: string; rent_allowed: string }>(`SELECT zone_id, rent_allowed FROM warehouse_zones WHERE zone_id=?`, i.zone_id);
    if (!z || z.rent_allowed !== "yes") throw new SpaceError(M("sp.err.never_rent"));
    if (!(i.area >= cfg.n("space.min_block_m2")) || !(i.price > 0) || !(i.start_date < i.end_date)) throw new SpaceError(M("sp.err.bad_terms"));
    if (diffDays(i.end_date, i.start_date) < cfg.n("space.min_lease_days")) throw new SpaceError(M("sp.err.too_short", { min: cfg.n("space.min_lease_days") }));
    const from = i.start_date < s.sim_date ? s.sim_date : i.start_date;
    const room = maxListable(cfg, i.zone_id, from, i.end_date);
    if (i.area > room + 1e-6) {
      const p = projectZones(cfg).get(i.zone_id);
      const drv = p?.drivers.find((x) => !x.pending && x.arrival < i.end_date);
      throw new SpaceError(M("sp.err.company_needs", { room, area: i.area, po: drv?.po_id ?? "", item: drv?.item_id ?? "", date: drv?.arrival ?? "" }));
    }
    const id = d.prepare(`INSERT INTO space_listings(zone_id,area,start_date,end_date,price,status,created_tick,published_tick) VALUES(?,?,?,?,?,?,?,?)`)
      .run(i.zone_id, i.area, i.start_date, i.end_date, i.price, i.publish ? "PUBLISHED" : "DRAFT", s.tick, i.publish ? s.tick : null).lastInsertRowid as number;
    if (i.publish) { d.prepare(`UPDATE space_listings SET window_tick=? WHERE id=?`).run(s.tick, id); planOffers(cfg, getListing(id) as Listing); }
    const decisionId = spaceDecision("LISTING", i.publish ? "PUBLISH" : "DRAFT", { zone: i.zone_id, listing: id, detail: { area: i.area, start: i.start_date, end: i.end_date, price: i.price } });
    logSpaceEvent(i.publish ? "LISTING_PUBLISHED" : "LISTING_DRAFT", M(i.publish ? "ev.sp.published" : "ev.sp.draft", { area: i.area, zone: i.zone_id, start: i.start_date, end: i.end_date, price: i.price }), "info", { actor: "user", ref: String(id) });
    out = { listingId: id, decisionId };
  })();
  return out;
}

export function keepVacant(i: { zone_id: string; area: number; start_date: string; end_date: string; reeval_date?: string; reason?: string }): { decisionId: number } {
  const cfg = loadSettings();
  const s = getSim();
  const reeval = i.reeval_date && i.reeval_date > s.sim_date ? i.reeval_date : addDays(s.sim_date, cfg.n("space.reeval_days"));
  let decisionId = 0;
  db().transaction(() => {
    decisionId = spaceDecision("KEEP_VACANT", "KEEP", { zone: i.zone_id, reeval, reason: (i.reason ?? "").slice(0, 200), detail: { area: i.area, start: i.start_date, end: i.end_date } });
    logSpaceEvent("KEEP_VACANT", M("ev.sp.kept", { area: i.area, zone: i.zone_id, until: reeval }), "info", { actor: "user" });
    createSpaceDraft({ action: "vacant", decisionId, zone: i.zone_id, area: i.area, start: i.start_date, end: i.end_date, reeval, note: (i.reason ?? "").slice(0, 200), why: M("draft.sp.vacant.why") });
  })();
  return { decisionId };
}

const EV_KEYS = { publish: "ev.sp.publish", pause: "ev.sp.pause", resume: "ev.sp.resume", withdraw: "ev.sp.withdraw", shrink: "ev.sp.shrink", reprice: "ev.sp.reprice" } as const;
export function setListingStatus(id: number, action: "publish" | "pause" | "resume" | "withdraw" | "shrink" | "reprice", area?: number, price?: number): { decisionId: number } {
  const d = db();
  const cfg = loadSettings();
  const s = getSim();
  let decisionId = 0;
  d.transaction(() => {
    const l = getListing(id);
    if (!l) throw new SpaceError(M("sp.err.listing_closed"));
    const open = ["DRAFT", "PUBLISHED", "PAUSED"].includes(l.status);
    if (!open) throw new SpaceError(M("sp.err.listing_closed"));
    if (action === "publish") {
      if (l.status !== "DRAFT") throw new SpaceError(M("sp.err.listing_closed"));
      if (listingRest(l) > maxListable(cfg, l.zone_id, l.start_date < s.sim_date ? s.sim_date : l.start_date, l.end_date, { excludeListing: l.id }) + 1e-6) throw new SpaceError(M("sp.err.company_needs", { room: 0, area: l.area, po: "", item: "", date: "" }));
      d.prepare(`UPDATE space_listings SET status='PUBLISHED', published_tick=?, window_tick=? WHERE id=?`).run(s.tick, s.tick, id);
      planOffers(cfg, getListing(id) as Listing);
    } else if (action === "pause") {
      if (l.status !== "PUBLISHED") throw new SpaceError(M("sp.err.listing_closed"));
      d.prepare(`UPDATE space_listings SET status='PAUSED' WHERE id=?`).run(id);
    } else if (action === "resume") {
      if (l.status !== "PAUSED") throw new SpaceError(M("sp.err.listing_closed"));
      d.prepare(`UPDATE space_listings SET status='PUBLISHED', resumed_tick=? WHERE id=?`).run(s.tick, id);
    } else if (action === "withdraw") {
      d.prepare(`UPDATE space_listings SET status='WITHDRAWN', closed_tick=? WHERE id=?`).run(s.tick, id);
      d.prepare(`UPDATE space_offers SET status='CLOSED', decided_tick=?, reason='withdrawn' WHERE listing_id=? AND status IN ('PENDING','COUNTERED')`).run(s.tick, id);
      d.prepare(`DELETE FROM space_offers WHERE listing_id=? AND status='SCHEDULED'`).run(id);
    } else if (action === "reprice") {
      if (l.status !== "PUBLISHED" || !(price !== undefined && price > 0)) throw new SpaceError(M("sp.err.bad_terms"));
      d.prepare(`UPDATE space_listings SET price=?, window_tick=? WHERE id=?`).run(price, s.tick, id);
      d.prepare(`DELETE FROM space_offers WHERE listing_id=? AND status='SCHEDULED'`).run(id);
      planOffers(cfg, getListing(id) as Listing);
    } else {
      const leased = l.area - listingRest(l);
      const a = Math.floor(area ?? 0);
      if (!(a >= Math.max(cfg.n("space.min_block_m2"), leased)) || a >= l.area) throw new SpaceError(M("sp.err.bad_terms"));
      d.prepare(`UPDATE space_listings SET area=? WHERE id=?`).run(a, id);
    }
    decisionId = spaceDecision("LISTING", action.toUpperCase(), { zone: l.zone_id, listing: id, detail: { area: area ?? l.area, before: l.area, price: price ?? l.price, was: l.price, start: l.start_date, end: l.end_date } });
    logSpaceEvent("LISTING_" + action.toUpperCase(), M(EV_KEYS[action], { area: area ?? l.area, zone: l.zone_id, price: price ?? l.price }), "info", { actor: "user", ref: String(id) });
  })();
  return { decisionId };
}

/** Undo what can still be undone: a listing nobody answered, a vacancy decision, a rejected offer, a lease that has not started. */
export function undoSpace(decisionId: number) {
  const d = db();
  const dec = one<{ id: number; kind: string; action: string; listing_id: number | null; offer_id: number | null; lease_id: number | null }>(`SELECT * FROM space_decisions WHERE id=?`, decisionId);
  if (!dec) throw new SpaceError(M("sp.err.cannot_undo"));
  const s = getSim();
  d.transaction(() => {
    if (dec.kind === "KEEP_VACANT") { /* the row is removed below: the window comes back */ }
    else if (dec.kind === "LISTING" && (dec.action === "PUBLISH" || dec.action === "DRAFT") && dec.listing_id) {
      if (one(`SELECT 1 FROM space_offers WHERE listing_id=? AND status<>'SCHEDULED'`, dec.listing_id)) throw new SpaceError(M("sp.err.cannot_undo"));
      d.prepare(`DELETE FROM space_offers WHERE listing_id=?`).run(dec.listing_id);
      d.prepare(`DELETE FROM space_listings WHERE id=?`).run(dec.listing_id);
    } else if (dec.kind === "OFFER" && dec.action === "REJECT" && dec.offer_id) {
      const o = getOffer(dec.offer_id);
      if (!o || o.status !== "REJECTED") throw new SpaceError(M("sp.err.cannot_undo"));
      d.prepare(`UPDATE space_offers SET status='PENDING', decided_tick=NULL, reason=NULL WHERE id=?`).run(o.id);
    } else if (dec.kind === "OFFER" && dec.action === "ACCEPT" && dec.lease_id) {
      const lease = one<Lease>(`SELECT * FROM space_leases WHERE id=?`, dec.lease_id);
      if (!lease || lease.status !== "RESERVED") throw new SpaceError(M("sp.err.cannot_undo"));
      d.prepare(`DELETE FROM space_leases WHERE id=?`).run(lease.id);
      d.prepare(`UPDATE space_offers SET status='PENDING', decided_tick=NULL WHERE id=?`).run(lease.offer_id);
      d.prepare(`UPDATE space_offers SET status='PENDING', reason=NULL WHERE request_id=? AND reason='taken' AND status='CLOSED'`).run(lease.request_id);
      d.prepare(`UPDATE space_listings SET status='PUBLISHED', closed_tick=NULL WHERE id=? AND status='LEASED'`).run(lease.listing_id);
    } else throw new SpaceError(M("sp.err.cannot_undo"));
    d.prepare(`DELETE FROM space_decisions WHERE id=?`).run(dec.id);
    dropDrafts(`space:${dec.id}`);
    logSpaceEvent("UNDO", M("ev.sp.undo"), "info", { actor: "user" });
  })();
  void s;
}

// ---------------------------------------------------------------- the hourly process
/** Offers expire, counter-offers are answered, new offers arrive, leases start and end, rent accrues. Called once per simulated hour. */
export function spaceHour(cfg: Settings, tick: number) {
  const d = db();
  const date = dateOf(tick), hour = tick - Math.floor(tick / 24) * 24;
  const seed = cfg.n("sim.seed");

  if (hour === 0) {
    for (const l of all<Lease>(`SELECT * FROM space_leases WHERE status='RESERVED' AND start_date<=?`, date)) {
      d.prepare(`UPDATE space_leases SET status='ACTIVE' WHERE id=?`).run(l.id);
      logSpaceEvent("LEASE_START", M("ev.sp.lease_start", { company: l.company, area: l.area, zone: l.zone_id, end: l.end_date }), "info", { ref: String(l.id) });
    }
    for (const l of all<Lease>(`SELECT * FROM space_leases WHERE status IN ('ACTIVE','RESERVED') AND end_date<=?`, date)) {
      d.prepare(`UPDATE space_leases SET status='ENDED', ended_tick=? WHERE id=?`).run(tick, l.id);
      logSpaceEvent("LEASE_END", M("ev.sp.lease_end", { company: l.company, area: l.area, zone: l.zone_id, income: l.income }), "info", { ref: String(l.id) });
    }
    // one more day of rent for every running lease
    for (const l of all<Lease>(`SELECT * FROM space_leases WHERE status='ACTIVE'`)) {
      d.prepare(`UPDATE space_leases SET income=income+?, income_days=income_days+1 WHERE id=?`).run(dailyIncome(l.area, l.price, cfg.n("space.days_per_month")), l.id);
    }
  }

  // planned offers whose hour has come become visible (a paused listing receives none until it is back online)
  for (const o of all<Offer>(`SELECT o.* FROM space_offers o JOIN space_listings l ON l.id=o.listing_id WHERE o.status='SCHEDULED' AND o.arrived_tick<=? AND l.status='PUBLISHED' ORDER BY o.arrived_tick, o.id`, tick)) {
    d.prepare(`UPDATE space_offers SET status='PENDING', valid_until_tick=? WHERE id=?`).run(Math.max(o.arrived_tick, tick) + cfg.n("space.offer_validity_h"), o.id);
    const l = getListing(o.listing_id) as Listing;
    logSpaceEvent("OFFER_ARRIVED", M("ev.sp.offer", { company: o.company, area: o.area, zone: l.zone_id, start: o.start_date, end: o.end_date, price: o.price }), "info", { ref: o.request_id });
  }

  for (const o of all<Offer>(`SELECT * FROM space_offers WHERE status='PENDING' AND valid_until_tick<=?`, tick)) {
    d.prepare(`UPDATE space_offers SET status='EXPIRED', decided_tick=? WHERE id=?`).run(tick, o.id);
    logSpaceEvent("OFFER_EXPIRED", M("ev.sp.expired", { company: o.company, area: o.area }), "info", { ref: String(o.id) });
  }

  for (const o of all<Offer>(`SELECT * FROM space_offers WHERE status='COUNTERED' AND counter_due_tick<=? ORDER BY id`, tick)) {
    const l = getListing(o.listing_id) as Listing;
    const t = JSON.parse(o.counter as string) as Terms;
    const p = counterAcceptProbability({ area: o.area, price: o.price }, { area: t.area, price: t.price }, cfg.n("space.counter_accept_prob"), cfg.n("space.price_sensitivity"));
    const yes = rand(`${seed}|canswer|${o.id}|${o.counter_n}`) < p;
    if (yes && ["PUBLISHED", "PAUSED"].includes(l.status) && evaluateOffer(cfg, { ...o, ...t }, l).can_accept) {
      const leaseId = createLease(o, l, tick, t);
      d.prepare(`UPDATE space_offers SET status='ACCEPTED', area=?, start_date=?, end_date=?, price=?, decided_tick=? WHERE id=?`).run(t.area, t.start_date, t.end_date, t.price, tick, o.id);
      spaceDecision("OFFER", "COUNTER_ACCEPTED", { zone: l.zone_id, listing: l.id, offer: o.id, lease: leaseId, detail: { company: o.company, ...t, per_day: dailyIncome(t.area, t.price, cfg.n("space.days_per_month")) } });
      logSpaceEvent("COUNTER_ACCEPTED", M("ev.sp.counter_yes", { company: o.company, area: t.area, zone: l.zone_id, start: t.start_date, end: t.end_date }), "info", { ref: String(o.id) });
    } else {
      d.prepare(`UPDATE space_offers SET status='DECLINED', decided_tick=? WHERE id=?`).run(tick, o.id);
      spaceDecision("OFFER", "COUNTER_DECLINED", { zone: l.zone_id, listing: l.id, offer: o.id, detail: { company: o.company, chance: p } });
      logSpaceEvent("COUNTER_DECLINED", M("ev.sp.counter_no", { company: o.company }), "info", { ref: String(o.id) });
    }
  }

  generateOffers(cfg, tick);
}

/** The terms a company offers for a listing: its own need (adapted to the listing about half of the time) and what it is willing to pay (below, at or above the asking price). */
function buildTerms(cfg: Settings, l: Listing, r: Pool, dueTick: number) {
  const seed = cfg.n("sim.seed"), mk = marketCfg(cfg);
  const rest = listingRest(l);
  let start = r.needed_from, area = r.area_needed_m2;
  const dueDate = dateOf(dueTick);
  if (start <= dueDate) start = addDays(dueDate, 1);
  let end = addMonths(start, r.duration_months);
  if (rand(`${seed}|fit|${l.id}|${r.request_id}`) < cfg.n("space.offer_fit_prob")) {
    const fs = start < l.start_date ? l.start_date : start, fe = end > l.end_date ? l.end_date : end;
    if (diffDays(fe, fs) >= cfg.n("space.min_lease_days")) { start = fs; end = fe; area = Math.min(area, rest); }
  }
  const price = tenantBid(mk.market, r.price_factor ?? 1, cfg.n("space.offer_bid_spread_pct"), rand(`${seed}|bid|${l.id}|${r.request_id}`));
  return { area, start, end, price };
}

/** Does the company's price reach the asking price closely enough to make an offer at all? */
const willing = (cfg: Settings, l: Listing, r: Pool) =>
  tenantBid(marketCfg(cfg).market, r.price_factor ?? 1, cfg.n("space.offer_bid_spread_pct"), rand(`${cfg.n("sim.seed")}|bid|${l.id}|${r.request_id}`)) >= l.price * cfg.n("space.min_bid_ratio");

export const reasonablePrice = (cfg: Settings, price: number) => price <= marketCfg(cfg).market * (1 + marketCfg(cfg).bandPct / 100) + 1e-9;

/**
 * Reliable arrival: when a listing goes online at a reasonable price, `space.offer_min_count` companies are chosen (seeded ranking of the free pool) and their offers are
 * planned inside `space.offer_window_days`, spread over hours. They stay invisible until their hour. Above the market band nothing is guaranteed.
 */
export function planOffers(cfg: Settings, l: Listing) {
  const d = db();
  const seed = cfg.n("sim.seed"), type = cfg.s("space.rentable_request_type");
  const k = Math.floor(cfg.n("space.offer_min_count")), windowH = cfg.n("space.offer_window_days") * 24, minDelay = Math.min(cfg.n("space.offer_delay_min_h"), Math.floor(windowH / 2));
  d.prepare(`UPDATE space_listings SET guaranteed=0 WHERE id=?`).run(l.id);
  if (!reasonablePrice(cfg, l.price) || k <= 0) return;
  const start = l.window_tick ?? l.published_tick ?? getSim().tick;
  const free = all<Pool>(`SELECT * FROM space_requests WHERE required_storage_type=? ORDER BY request_id`, type)
    .filter((r) => !one(`SELECT 1 FROM space_leases WHERE request_id=?`, r.request_id) && !one(`SELECT 1 FROM space_offers WHERE listing_id=? AND request_id=?`, l.id, r.request_id) && r.needed_from < l.end_date)
    .sort((a, b) => rand(`${seed}|rank|${l.id}|${a.request_id}`) - rand(`${seed}|rank|${l.id}|${b.request_id}`));
  const chosen = free.slice(0, k);
  chosen.forEach((r, i) => {
    const due = start + Math.round(minDelay + ((i + rand(`${seed}|spread|${l.id}|${r.request_id}`)) / chosen.length) * Math.max(0, windowH - 6 - minDelay));
    const t = buildTerms(cfg, l, r, due);
    d.prepare(`INSERT INTO space_offers(listing_id,request_id,company,area,start_date,end_date,price,status,arrived_tick,valid_until_tick) VALUES(?,?,?,?,?,?,?,'SCHEDULED',?,?)`)
      .run(l.id, r.request_id, r.company, t.area, t.start, t.end, t.price, due, due + cfg.n("space.offer_validity_h"));
  });
  d.prepare(`UPDATE space_listings SET guaranteed=? WHERE id=?`).run(chosen.length, l.id);
}

/** Pool of potential tenants + published listings -> more offers over time (the planned ones are on top of this). Deterministic: the same seed gives the same offers at the same hours. */
export function generateOffers(cfg: Settings, tick: number) {
  const d = db();
  const seed = cfg.n("sim.seed"), mk = marketCfg(cfg), type = cfg.s("space.rentable_request_type");
  const pool = all<Pool>(`SELECT * FROM space_requests WHERE required_storage_type=? ORDER BY created_tick, request_id`, type);
  if (!pool.length) return;
  for (const l of all<Listing>(`SELECT * FROM space_listings WHERE status='PUBLISHED' ORDER BY id`)) {
    const rest = listingRest(l);
    if (rest <= 0) continue;
    for (const r of pool) {
      if (one(`SELECT 1 FROM space_offers WHERE listing_id=? AND request_id=?`, l.id, r.request_id)) continue;
      if (one(`SELECT 1 FROM space_leases WHERE request_id=?`, r.request_id)) continue;
      if (r.needed_from >= l.end_date) continue;
      const due = (l.published_tick ?? l.created_tick) + arrivalDelayHours(l.price, rand(`${seed}|delay|${l.id}|${r.request_id}`), mk);
      if (tick < due) continue;
      if (rand(`${seed}|prob|${l.id}|${r.request_id}`) >= arrivalProbability(l.price, mk)) continue;
      if (!willing(cfg, l, r)) continue;
      const t = buildTerms(cfg, l, r, due);
      d.prepare(`INSERT INTO space_offers(listing_id,request_id,company,area,start_date,end_date,price,status,arrived_tick,valid_until_tick) VALUES(?,?,?,?,?,?,?,'PENDING',?,?)`)
        .run(l.id, r.request_id, r.company, t.area, t.start, t.end, t.price, due, due + cfg.n("space.offer_validity_h"));
      logSpaceEvent("OFFER_ARRIVED", M("ev.sp.offer", { company: r.company, area: t.area, zone: l.zone_id, start: t.start, end: t.end, price: t.price }), "info", { ref: r.request_id });
    }
  }
}

/** A listing that got no offer in the window: what the manager can change (price, dates / area, split). */
export function listingAdvice(cfg: Settings) {
  const tick = getSim().tick, windowH = cfg.n("space.offer_window_days") * 24, mk = marketCfg(cfg);
  const out: { listing_id: number; zone_id: string; price: number; market: number; high: boolean; suggest_price: number; age: number }[] = [];
  for (const l of all<Listing>(`SELECT * FROM space_listings WHERE status='PUBLISHED' ORDER BY id`)) {
    const since = l.window_tick ?? l.published_tick ?? tick;
    if (tick - since < windowH || listingRest(l) <= 0) continue;
    if (one(`SELECT 1 FROM space_offers WHERE listing_id=?`, l.id)) continue;
    const high = !reasonablePrice(cfg, l.price);
    out.push({ listing_id: l.id, zone_id: l.zone_id, price: l.price, market: mk.market, high, suggest_price: Math.min(l.price, cfg.n("space.price_suggested")), age: tick - since });
  }
  return out;
}

/** Demand that never became (and cannot become) an offer, with the plain reason. Informational. */
export function unmatchedDemand(cfg: Settings) {
  const type = cfg.s("space.rentable_request_type");
  const mk = marketCfg(cfg), seed = cfg.n("sim.seed");
  const tick = getSim().tick;
  const out: { request_id: string; company: string; area: number; months: number; from: string; type: string; reason: Msg }[] = [];
  const zones = all<{ zone_name: string; storage_type: string; rent_allowed: string }>(`SELECT zone_name, storage_type, rent_allowed FROM warehouse_zones`);
  const listings = all<Listing>(`SELECT * FROM space_listings WHERE status IN ('PUBLISHED','PAUSED','LEASED','WITHDRAWN') AND published_tick IS NOT NULL`);
  for (const r of all<Pool>(`SELECT * FROM space_requests ORDER BY created_tick, request_id`)) {
    const base = { request_id: r.request_id, company: r.company, area: r.area_needed_m2, months: r.duration_months, from: r.needed_from, type: r.required_storage_type };
    if (r.required_storage_type !== type) {
      const z = zones.find((x) => x.storage_type === r.required_storage_type && x.rent_allowed !== "yes");
      out.push({ ...base, reason: M("sp.unmatched.never", { type: r.required_storage_type, zone: z?.zone_name ?? "" }) });
      continue;
    }
    if (one(`SELECT 1 FROM space_offers WHERE request_id=?`, r.request_id)) continue;
    const l = listings.find((x) => x.status === "PUBLISHED" && !one(`SELECT 1 FROM space_offers WHERE listing_id=? AND request_id=?`, x.id, r.request_id));
    if (!l) continue;
    const due = (l.published_tick as number) + arrivalDelayHours(l.price, rand(`${seed}|delay|${l.id}|${r.request_id}`), mk);
    if (tick < due) continue;
    if (r.needed_from >= l.end_date) out.push({ ...base, reason: M("sp.unmatched.dates", { to: l.end_date }) });
    else if (rand(`${seed}|prob|${l.id}|${r.request_id}`) >= arrivalProbability(l.price, mk) || !willing(cfg, l, r)) out.push({ ...base, reason: M("sp.unmatched.price", { price: l.price, market: mk.market }) });
  }
  return out;
}
