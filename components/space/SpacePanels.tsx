"use client";
import { memo } from "react";
import { useSnap } from "@/lib/store";
import { useApp, useBusy } from "../ctx";
import { Btn, CardHead, Empty, ExplainBtn, Pill } from "../ui";

type Listing = ReturnType<typeof useListings>[number];
const useListings = () => useSnap((s) => s.space.listings);
type Offer = ReturnType<typeof useOffers>[number];
const useOffers = () => useSnap((s) => s.space.offers);

const LST_TONE: Record<string, string> = { DRAFT: "PENDING", PUBLISHED: "ACTIVE", PAUSED: "Monitor", WITHDRAWN: "ENDED", LEASED: "RESERVED" };
const OFFER_TONE: Record<string, string> = { PENDING: "Info", COUNTERED: "Monitor", ACCEPTED: "APPROVED", REJECTED: "REJECTED", EXPIRED: "ENDED", DECLINED: "REJECTED", CLOSED: "ENDED" };

const ListingRow = memo(function ListingRow({ l }: { l: Listing }) {
  const { T, R, D, spaceAct, confirm } = useApp();
  const busy = useBusy();
  const warn = useSnap((s) => s.space.po_warnings.find((w) => w.listing_id === l.id));
  const act = (action: string, msg: string) => spaceAct(`/api/space/listings/${l.id}`, { action }, { k: msg, v: { zone: l.zone_id, area: l.rest } });
  const open = ["DRAFT", "PUBLISHED", "PAUSED"].includes(l.status);
  return (
    <li className="rounded-xl border border-line bg-surface p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{R({ k: "sp.list.title", v: { area: l.area, zone: l.zone_id } })}</span>
        <Pill tone={LST_TONE[l.status]}>{T(`sp.lst.${l.status}`)}</Pill>
      </div>
      <div className="text-xs text-muted">
        <span className="num">{D(l.start_date)}</span> → <span className="num">{D(l.end_date)}</span> · {R({ k: "sp.list.price", v: { price: l.price } })}
        {l.leased > 0 && <> · {R({ k: "sp.list.leased", v: { leased: l.leased, rest: l.rest } })}</>}
        {l.offers_pending > 0 && <> · <strong className="text-info">{R({ k: "sp.list.offers", v: { n: l.offers_pending } })}</strong></>}
      </div>
      {warn && <p className="mt-1 rounded-md bg-mon-soft px-2 py-1 text-xs">▲ {R({ k: "sp.list.po_warn", v: { short: warn.short, item: warn.item_id, date: warn.arrival } })}</p>}
      {open && (
        <div className="mt-2 flex flex-wrap gap-2">
          {l.status === "DRAFT" && <Btn tone="ok" disabled={busy} onClick={() => act("publish", "toast.sp.published")}>{T("sp.btn.publish")}</Btn>}
          {l.status === "PUBLISHED" && <Btn disabled={busy} onClick={() => act("pause", "toast.sp.listing_changed")}>{T("sp.btn.pause")}</Btn>}
          {l.status === "PAUSED" && <Btn tone="ok" disabled={busy} onClick={() => act("resume", "toast.sp.listing_changed")}>{T("sp.btn.resume")}</Btn>}
          <Btn tone="bad" disabled={busy} onClick={async () => { if (await confirm({ title: T("sp.confirm.withdraw_title"), body: R({ k: "sp.confirm.withdraw_body", v: { n: l.offers_pending } }), action: T("sp.btn.withdraw"), danger: true })) act("withdraw", "toast.sp.listing_changed"); }}>{T("sp.btn.withdraw")}</Btn>
        </div>
      )}
    </li>
  );
});

const OfferHistoryRow = memo(function OfferHistoryRow({ o }: { o: Offer }) {
  const { T, R, DT, D } = useApp();
  return (
    <li className="rounded-lg bg-surface2 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{o.company}</span><Pill tone={OFFER_TONE[o.status]}>{T(`sp.off.${o.status}`)}</Pill></div>
      <div className="text-xs text-muted">
        <span className="num">{R({ k: "sp.off.line", v: { area: o.area, price: o.price } })}</span> · <span className="num">{D(o.start_date)}</span> → <span className="num">{D(o.end_date)}</span> · {T("sp.offer.arrived")} <span className="num">{DT(o.arrived_tick)}</span>
        {o.status === "REJECTED" && o.reason && <> · {T(`sp.reject.${o.reason}`)}</>}
        {o.status === "COUNTERED" && o.counter && <> · {R({ k: "sp.off.counter_line", v: { area: o.counter.area, price: o.counter.price } })} · {T("sp.off.answer_by")} <span className="num">{DT(o.counter_due_tick as number)}</span></>}
      </div>
    </li>
  );
});

/** Listings (what we offer) and the offers that came in (history of every answer). */
export function ListingsPanel() {
  const { T, N } = useApp();
  const listings = useListings(), offers = useOffers();
  const handled = offers.filter((o) => o.status !== "PENDING");
  return (
    <section id="listings" className="card scroll-mt-24" aria-label={T("sp.listings.title")}>
      <CardHead title={T("sp.listings.title")} sub={T("sp.listings.sub")} />
      <div className="grid grid-cols-1 lg:grid-cols-2">
        <div className="min-w-0 border-b border-line lg:border-b-0 lg:border-e">
          <h3 className="px-4 pt-3 text-sm font-bold">{T("sp.listings.mine")} <span className="num text-muted">({N(listings.length)})</span></h3>
          <ul className="scroll-thin h-[360px] space-y-2 overflow-y-auto p-3">
            {listings.length === 0 && <li className="h-full"><Empty icon="▭" title={T("sp.listings.empty")} text={T("sp.listings.empty_text")} /></li>}
            {listings.map((l) => <ListingRow key={l.id} l={l} />)}
          </ul>
        </div>
        <div className="min-w-0">
          <h3 className="px-4 pt-3 text-sm font-bold">{T("sp.offers.answered")} <span className="num text-muted">({N(handled.length)})</span></h3>
          <ul className="scroll-thin h-[360px] space-y-1.5 overflow-y-auto p-3">
            {handled.length === 0 && <li className="h-full"><Empty icon="✉" title={T("sp.offers.empty")} text={T("sp.offers.empty_text")} /></li>}
            {handled.map((o) => <OfferHistoryRow key={o.id} o={o} />)}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** Leases and the rent they bring in. */
export function LeasesPanel() {
  const { T, R, D, OMR } = useApp();
  const leases = useSnap((s) => s.space.leases), kpi = useSnap((s) => s.space.kpi), ex = useSnap((s) => s.space.kpi_explain.income);
  return (
    <section id="leases" className="card scroll-mt-24" aria-label={T("sp.leases.title")}>
      <CardHead title={T("sp.leases.title")} sub={T("sp.leases.sub")}
        right={<div className="text-end"><div className="text-xs text-muted">{T("sp.kpi.income")}<ExplainBtn e={ex} /></div><div className="num text-lg font-bold text-ok">{OMR(kpi.income_total)}</div></div>} />
      <ul className="scroll-thin h-[300px] space-y-2 overflow-y-auto p-3">
        {leases.length === 0 && <li className="h-full"><Empty icon="▭" title={T("sp.leases.empty")} text={T("sp.leases.empty_text")} /></li>}
        {leases.map((l) => (
          <li key={l.id} className="rounded-xl border border-line bg-surface p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{l.company}</span><Pill tone={l.status}>{T(`lease.${l.status}`)}</Pill></div>
            <div className="text-xs text-muted">{R({ k: "sp.lease.line", v: { area: l.area, zone: l.zone_id, price: l.price } })} · <span className="num">{D(l.start_date)}</span> → <span className="num">{D(l.end_date)}</span></div>
            <div className="mt-0.5 text-xs">{R({ k: "sp.lease.income", v: { day: l.per_day, income: l.income, days: l.income_days } })}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The forecast behind every window: what the company will need and why some periods cannot be listed. */
export function ForecastPanel() {
  const { T, R } = useApp();
  const windows = useSnap((s) => s.space.windows), blocked = useSnap((s) => s.space.blocked), days = useSnap((s) => s.space.settings.forecast_days);
  return (
    <section id="forecast" className="card scroll-mt-24" aria-label={T("sp.forecast.title")}>
      <CardHead title={T("sp.forecast.title")} sub={R({ k: "sp.forecast.sub", v: { days } })} />
      <div className="grid grid-cols-1 lg:grid-cols-2">
        <div className="min-w-0 border-b border-line lg:border-b-0 lg:border-e">
          <h3 className="px-4 pt-3 text-sm font-bold">{T("sp.forecast.free")}</h3>
          <ul className="scroll-thin h-[300px] space-y-2 overflow-y-auto p-3">
            {windows.length === 0 && <li className="h-full"><Empty icon="◔" title={T("sp.forecast.none")} text={T("sp.forecast.none_text")} /></li>}
            {windows.map((w) => (
              <li key={w.key} className="rounded-xl border border-line bg-surface p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{R({ k: "sp.win.title", v: { area: w.area, zone: w.zone_id } })}<ExplainBtn e={w.explain} /></span>
                  <Pill tone={w.state === "HELD" ? "Monitor" : "OK"}>{w.state === "HELD" ? R({ k: "sp.win.held", v: { until: w.held_until } }) : T("sp.win.open")}</Pill>
                </div>
                <div className="text-xs text-muted">{R({ k: w.to_horizon ? "sp.win.when_open" : "sp.win.when", v: { from: w.start, to: w.end } })} · {T(`sp.conf.${w.confidence}`)}</div>
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0">
          <h3 className="px-4 pt-3 text-sm font-bold">{T("sp.forecast.blocked")}</h3>
          <ul className="scroll-thin h-[300px] space-y-2 overflow-y-auto p-3">
            {blocked.length === 0 && <li className="h-full"><Empty title={T("sp.forecast.nothing_blocked")} /></li>}
            {blocked.map((b) => {
              const dr = (b.drivers as { po_id: string; item_id: string; area: number; arrival: string }[]) ?? [];
              return (
                <li key={b.key} className="rounded-xl border border-line bg-surface p-3 text-sm">
                  <div className="font-semibold">{R({ k: "sp.blocked.title", v: { zone: b.zone_id, from: b.start, to: b.end } })}</div>
                  <p className="text-xs text-muted">{R({ k: "sp.blocked.why", v: { need: b.peak_need, capacity: b.capacity, leased: b.leased, listed: b.listed } })}</p>
                  {dr.length > 0 && <ul className="mt-1 list-disc ps-5 text-xs text-muted">{dr.map((x) => <li key={x.po_id}>{R({ k: "sp.blocked.po", v: { po: x.po_id, item: x.item_id, area: x.area, arrival: x.arrival } })}</li>)}</ul>}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** Demand that cannot become an offer (and why). Informational: it shows that cold and hazardous space is protected. */
export function UnmatchedPanel() {
  const { T, R } = useApp();
  const rows = useSnap((s) => s.space.unmatched);
  return (
    <section id="unmatched" className="card scroll-mt-24" aria-label={T("sp.unmatched.title")}>
      <CardHead title={T("sp.unmatched.title")} sub={T("sp.unmatched.sub")} />
      <ul className="scroll-thin h-[200px] divide-y divide-line overflow-y-auto">
        {rows.length === 0 && <li className="h-full"><Empty icon="✓" title={T("sp.unmatched.empty")} /></li>}
        {rows.map((r) => (
          <li key={r.request_id} className="px-4 py-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{r.company}</span><Pill tone="ENDED" icon={false}>{R({ k: "sp.unmatched.want", v: { area: r.area, type: r.type } })}</Pill></div>
            <div className="text-xs text-muted">{R({ k: "sp.unmatched.line", v: { months: r.months, from: r.from } })} · {R(r.reason)}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
