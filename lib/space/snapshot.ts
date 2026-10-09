import { db } from "../db";
import { getSim, type Msg } from "../core";
import { loadSettings } from "../settings";
import { dailyIncome, ex, type Explain } from "../calc";
import { evaluateOffer, listingAdvice, listingRest, reasonablePrice, unmatchedDemand, type Lease, type Listing, type Offer } from "./market";
import { projectZones } from "./forecast";
import { addDays, addMonths, diffDays } from "../time";

const all = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).all(...a) as T[];

/** Everything the Space section shows. Numbers come from the tables and lib/calc; the UI only formats them. */
export function spaceSnapshot() {
  const cfg = loadSettings();
  const sim = getSim();
  const dpm = cfg.n("space.days_per_month");
  const zoneName = new Map(all<{ zone_id: string; zone_name: string }>(`SELECT zone_id, zone_name FROM warehouse_zones`).map((z) => [z.zone_id, z.zone_name]));

  const fc = all(`SELECT * FROM space_forecasts ORDER BY zone_id, start_date, area DESC`).map((r) => ({ ...r, inputs: JSON.parse(r.inputs), pending_note: r.pending_note ? (JSON.parse(r.pending_note) as Msg) : null }));
  const windows = fc.filter((r) => r.state === "NEW" || r.state === "HELD").map((r) => {
    const i = r.inputs;
    const explain: Explain = ex("ex.sp.window", [
      { label: "ex.sp.in.capacity", value: i.capacity, unit: "m²", source: "warehouse_zones" },
      { label: "ex.sp.in.fixed", value: `${i.fixed} + ${i.buffer}`, unit: "m²", source: "warehouse_zones" },
      { label: "ex.sp.in.peak_need", value: Math.round(i.peak_need), unit: "m²", source: "current_stock + purchase_orders_open + forecasts" },
      { label: "ex.sp.in.leased", value: Math.round(i.leased), unit: "m²", source: "space_leases" },
      { label: "ex.sp.in.listed", value: Math.round(i.listed), unit: "m²", source: "space_listings" },
      { label: "ex.sp.in.margin", value: i.margin, unit: "%", source: "settings" },
    ], r.area, "m²");
    const sugEnd = r.to_horizon ? addMonths(r.start_date, cfg.n("space.default_listing_months")) : r.end_date;
    const sug = { start: r.start_date, end: sugEnd, area: r.area, price: cfg.n("space.price_suggested"), days: diffDays(sugEnd, r.start_date), months: Math.max(1, Math.round(diffDays(sugEnd, r.start_date) / dpm)) };
    return { inputs: i as Record<string, any>, suggest: sug, key: `${r.zone_id}|${r.start_date}|${r.to_horizon ? "H" : r.end_date}`, zone_id: r.zone_id, zone_name: zoneName.get(r.zone_id) ?? r.zone_id, start: r.start_date, end: r.end_date, area: r.area, confidence: r.confidence,
      state: r.state as "NEW" | "HELD", held_until: r.held_until, to_horizon: !!r.to_horizon, pending_area: r.pending_area, pending_note: r.pending_note, since_tick: r.first_tick ?? sim.tick, drivers: i.drivers as unknown[], explain };
  });
  const blocked = fc.filter((r) => r.state === "BLOCKED").map((r) => ({ key: `${r.zone_id}|${r.start_date}`, zone_id: r.zone_id, start: r.start_date, end: r.end_date, to_horizon: !!r.to_horizon, peak_need: r.inputs.peak_need, capacity: r.inputs.capacity, leased: r.inputs.leased, listed: r.inputs.listed, drivers: r.inputs.drivers as unknown[] }));
  const alertSince = new Map(all<{ key: string; first_tick: number }>(`SELECT key, first_tick FROM alerts WHERE kind='LISTING_RISK' AND active=1`).map((a) => [a.key, a.first_tick]));
  const lstArea = new Map(all<{ id: number; area: number }>(`SELECT id, area FROM space_listings`).map((l) => [l.id, l.area]));
  // shrinking sets the WHOLE listing area: the part already leased stays, plus what still fits (ok_area is about the unleased rest only)
  const shrinkOf = (id: number, rest: number, ok: number) => { const area = lstArea.get(id) ?? rest, leased = area - rest, to = Math.floor(leased + ok); return { shrink_to: to, can_shrink: to >= Math.max(cfg.n("space.min_block_m2"), leased) && to < area }; };
  const conflicts = fc.filter((r) => r.state === "CONFLICT").map((r) => ({ ...shrinkOf(r.inputs.listing_id as number, r.inputs.rest as number, r.inputs.ok_area as number), key: `CONFLICT:LISTING:${r.inputs.listing_id}`, listing_id: r.inputs.listing_id as number, zone_id: r.zone_id, from: r.start_date, to: r.end_date, short: r.area, rest: r.inputs.rest as number, ok_area: r.inputs.ok_area as number, driver: r.inputs.driver as { po_id: string; item_id: string; qty: number; area: number; arrival: string } | null, since_tick: alertSince.get(`CONFLICT:LISTING:${r.inputs.listing_id}`) ?? sim.tick }));

  const poWarnings = fc.filter((r) => r.state === "WARN").map((r) => ({ listing_id: r.inputs.listing_id as number, zone_id: r.zone_id, from: r.start_date, to: r.end_date, short: r.area, rest: r.inputs.rest as number, item_id: r.inputs.draft.item_id as string, qty: r.inputs.draft.qty as number, area: r.inputs.draft.area as number, arrival: r.inputs.draft.arrival as string }));

  const lstRows = all<Listing>(`SELECT * FROM space_listings ORDER BY id DESC`);
  const offersRaw = all<Offer>(`SELECT * FROM space_offers WHERE status<>'SCHEDULED' ORDER BY id DESC`); // planned offers stay invisible until their hour
  const projByListing = new Map<number, ReturnType<typeof projectZones>>();
  const listings = lstRows.map((l) => {
    const rest = listingRest(l);
    const mine = offersRaw.filter((o) => o.listing_id === l.id);
    return { ...l, zone_name: zoneName.get(l.zone_id) ?? l.zone_id, rest, leased: l.area - rest, offers_pending: mine.filter((o) => o.status === "PENDING").length, offers_total: mine.length, per_day_if_leased: dailyIncome(l.area, l.price, dpm), price_note: (reasonablePrice(cfg, l.price) ? "ok" : "high") as "ok" | "high", waiting_since: sim.tick - (l.window_tick ?? l.published_tick ?? sim.tick) };
  });
  const poWarn = new Set(poWarnings.map((w) => w.listing_id));
  const lstById = new Map(lstRows.map((l) => [l.id, l]));
  const offers = offersRaw.map((o) => {
    const l = lstById.get(o.listing_id) as Listing;
    let evalr = null;
    if (o.status === "PENDING") {
      if (!projByListing.has(l.id)) projByListing.set(l.id, projectZones(cfg, { excludeListing: l.id }));
      evalr = evaluateOffer(cfg, o, l, projByListing.get(l.id));
    }
    return { ...o, zone_id: l.zone_id, listing_price: l.price, listing_start: l.start_date, listing_end: l.end_date, counter: o.counter ? JSON.parse(o.counter) : null, eval: evalr, age_hours: sim.tick - o.arrived_tick, expires_in: o.valid_until_tick - sim.tick,
      per_day: dailyIncome(o.area, o.price, dpm),
      compare: (() => {
        const days = Math.max(0, Math.round((Date.parse(o.end_date) - Date.parse(o.start_date)) / 86400000));
        const needs = evalr?.checks.find((c) => c.key === "needs")?.level;
        const risk = !evalr ? "none" : needs === "bad" ? "blocked" : l.zone_id && poWarn.has(l.id) ? "watch" : "none";
        return {
          monthly: o.area * o.price, days, months: days / dpm, total: dailyIncome(o.area, o.price, dpm) * days,
          fit_dates: o.start_date >= l.start_date && o.end_date <= l.end_date ? "inside" : "partly", fit_area: o.area <= listingRest(l) + 1e-6 ? "fits" : "too_big", risk,
        };
      })() };
  });
  const leases = all<Lease>(`SELECT * FROM space_leases ORDER BY status='ENDED', start_date, id`).map((l) => ({ ...l, zone_name: zoneName.get(l.zone_id) ?? l.zone_id, per_day: dailyIncome(l.area, l.price, dpm), total: dailyIncome(l.area, l.price, dpm) * Math.max(1, Math.round((Date.parse(l.end_date) - Date.parse(l.start_date)) / 86400000)) }));

  const active = leases.filter((l) => l.status === "ACTIVE"), reserved = leases.filter((l) => l.status === "RESERVED");
  const income = leases.reduce((a, l) => a + l.income, 0);
  const newWindows = windows.filter((w) => w.state === "NEW");
  const pendingOffers = offers.filter((o) => o.status === "PENDING");
  const advice = listingAdvice(cfg);
  const queue = newWindows.length + pendingOffers.length + conflicts.length + advice.length;
  const ages = [...newWindows.map((w) => sim.tick - w.since_tick), ...pendingOffers.map((o) => o.age_hours), ...conflicts.map((c) => sim.tick - c.since_tick)];
  const published = listings.filter((l) => l.status === "PUBLISHED" || l.status === "PAUSED");
  const kpi = {
    listable_m2: newWindows.length ? Math.max(...[...new Set(newWindows.map((w) => w.zone_id))].map((z) => Math.max(...newWindows.filter((w) => w.zone_id === z).map((w) => w.area)))) : 0,
    listable_total_m2: [...new Set(newWindows.map((w) => w.zone_id))].reduce((a, z) => a + Math.max(...newWindows.filter((w) => w.zone_id === z).map((w) => w.area)), 0),
    listed_m2: published.reduce((a, l) => a + l.rest, 0),
    offers_waiting: pendingOffers.length,
    leased_m2: active.reduce((a, l) => a + l.area, 0) + reserved.reduce((a, l) => a + l.area, 0),
    income_total: income,
    income_per_day: active.reduce((a, l) => a + l.per_day, 0),
    waiting: queue, oldest_age: ages.length ? Math.max(...ages) : 0,
  };
  const explain = {
    income: ex("ex.sp.income", leases.filter((l) => l.income > 0 || l.status === "ACTIVE").slice(0, 8).map((l) => ({ label: "ex.sp.in.lease_income", value: `${Math.round(l.area)} m² × ${l.price} × ${l.income_days} / ${dpm}`, unit: "OMR", source: l.company })), income, "OMR"),
    listable: ex("ex.sp.listable", newWindows.slice(0, 6).map((w) => ({ label: "ex.sp.in.window", value: `${w.zone_id}: ${Math.round(w.area)} m² (${w.start} → ${w.to_horizon ? "…" : w.end})`, unit: "m²", source: "space_forecasts" })), kpi.listable_total_m2, "m²"),
  };
  const flow = { forecast: newWindows.length + windows.filter((w) => w.state === "HELD").length, decide: newWindows.length + conflicts.length, listing: published.length, offers: pendingOffers.length, leases: active.length + reserved.length };
  const next: "forecast" | "decide" | "listing" | "offers" | "leases" = conflicts.length || pendingOffers.length ? "offers" : newWindows.length ? "decide" : published.length ? "listing" : leases.length ? "leases" : "forecast";
  const unmatched = unmatchedDemand(cfg);
  const zones = all<{ zone_id: string }>(`SELECT zone_id FROM warehouse_zones WHERE rent_allowed='yes' ORDER BY zone_id`).map((z) => z.zone_id);
  return {
    settings: {
      price_suggested: cfg.n("space.price_suggested"), price_market: cfg.n("space.price_market"), band_pct: cfg.n("space.price_band_pct"), margin_pct: cfg.n("space.safety_margin_pct"),
      min_block: cfg.n("space.min_block_m2"), min_days: cfg.n("space.min_lease_days"), step: cfg.n("space.area_step_m2"), reeval_days: cfg.n("space.reeval_days"), reeval_date: addDays(sim.sim_date, cfg.n("space.reeval_days")), forecast_days: cfg.n("space.forecast_days"), days_per_month: dpm, offer_min_count: cfg.n("space.offer_min_count"), offer_window_days: cfg.n("space.offer_window_days"), pool_total: (all(`SELECT COUNT(*) n FROM space_requests`)[0]?.n as number) ?? 0,
    },
    zones, windows, blocked, conflicts, po_warnings: poWarnings, advice, listings, offers, leases, unmatched, kpi, kpi_explain: explain, flow, next,
  };
}
export type SpaceSnapshot = ReturnType<typeof spaceSnapshot>;
