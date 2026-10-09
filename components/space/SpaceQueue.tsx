"use client";
import { memo, useMemo, useState } from "react";
import { useSnap } from "@/lib/store";
import { useApp, useBusy } from "../ctx";
import { Btn, Empty, ExplainBtn, Pill } from "../ui";
import { CounterDialog, ListDialog, RejectDialog, VacantDialog } from "./SpaceDialogs";

type Win = ReturnType<typeof useWindows>[number];
const useWindows = () => useSnap((s) => s.space.windows);
type Offer = ReturnType<typeof useOffers>[number];
const useOffers = () => useSnap((s) => s.space.offers);
type Conflict = ReturnType<typeof useConflicts>[number];
type AdviceT = ReturnType<typeof useAdvice>[number];
const useAdvice = () => useSnap((s) => s.space.advice);
const useConflicts = () => useSnap((s) => s.space.conflicts);

const Row = ({ k, children, tone }: { k: string; children: React.ReactNode; tone?: string }) => {
  const { T } = useApp();
  return <div className={tone ?? ""}><dt className="inline font-semibold">{T(k)}: </dt><dd className="inline text-muted">{children}</dd></div>;
};
const LEVEL: Record<string, { icon: string; cls: string }> = { ok: { icon: "✓", cls: "text-ok" }, warn: { icon: "▲", cls: "text-mon" }, bad: { icon: "✕", cls: "text-crit" } };

/** A free window: the system found space the company will not need. One main action (list it), one quieter one (keep it empty). */
const WindowCard = memo(function WindowCard({ w }: { w: Win }) {
  const { T, R, DT, DUR } = useApp();
  const busy = useBusy();
  const tick = useSnap((s) => s.sim.tick);
  const reeval = useSnap((s) => s.space.settings.reeval_date);
  const [dlg, setDlg] = useState<"list" | "vacant" | null>(null);
  const i = w.inputs;
  const to = w.to_horizon ? "" : w.end;
  return (
    <li className="rounded-xl border border-line bg-surface p-3.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <Pill tone="RESERVED" icon={false}>{T("sp.kind.window")}</Pill>
        <Pill tone={w.confidence === "high" ? "OK" : w.confidence === "medium" ? "Monitor" : "Low"}>{T(`sp.conf.${w.confidence}`)}</Pill>
        <span className="text-xs text-muted">{T("dc.waiting")} <span className="num font-semibold text-ink">{DUR(tick - w.since_tick)}</span> · {T("since")} <span className="num">{DT(w.since_tick)}</span></span>
        <ExplainBtn e={w.explain} />
      </div>
      <h3 className="text-base font-bold leading-snug">{R({ k: "sp.win.title", v: { area: w.area, zone: w.zone_id } })}</h3>
      <dl className="mt-1.5 space-y-1 text-sm">
        <Row k="sp.when">{R({ k: w.to_horizon ? "sp.win.when_open" : "sp.win.when", v: { from: w.start, to } })}</Row>
        <Row k="dc.why">{R({ k: "sp.win.why", v: { peak: i.peak_need, capacity: i.capacity, margin: i.margin, area: w.area, zone: w.zone_id } })}</Row>
        <Row k="sp.todo">{T("sp.win.todo")}</Row>
        <Row k="dc.ignore" tone="rounded-md bg-high-soft/60 px-2 py-1">{T("sp.win.ignore")}</Row>
      </dl>
      {w.pending_area > 0 && w.pending_note && <p className="mt-1.5 rounded-md bg-mon-soft px-2 py-1 text-sm"><strong className="text-mon">▲ {T("sp.warning")}: </strong>{R(w.pending_note)}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Btn tone="ok" size="lg" disabled={busy} className="grow sm:grow-0" onClick={() => setDlg("list")}>{R({ k: "sp.btn.list", v: { area: w.suggest.area, months: w.suggest.months, price: w.suggest.price } })}</Btn>
        <Btn disabled={busy} onClick={() => setDlg("vacant")}>{R({ k: "sp.btn.keep", v: { until: reeval } })}</Btn>
      </div>
      {dlg === "list" && <ListDialog w={w} onClose={() => setDlg(null)} />}
      {dlg === "vacant" && <VacantDialog w={w} onClose={() => setDlg(null)} />}
    </li>
  );
});

/** An offer from a company: six automatic checks in plain words, then Accept / Counter-offer / Reject. */
const OfferCard = memo(function OfferCard({ o }: { o: Offer }) {
  const { T, R, DT, DUR, spaceAct } = useApp();
  const busy = useBusy();
  const [dlg, setDlg] = useState<"counter" | "reject" | null>(null);
  const ev = o.eval;
  const blocked = ev && !ev.can_accept;
  return (
    <li className={`rounded-xl border bg-surface p-3.5 ${o.flag ? "border-high" : "border-line"}`}>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <Pill tone="Info" icon={false}>{T("sp.kind.offer")}</Pill>
        {o.flag && <Pill tone="High">{T("sp.offer.now_needed")}</Pill>}
        <span className="text-xs text-muted">{T("sp.offer.arrived")} <span className="num">{DT(o.arrived_tick)}</span> · {T("sp.offer.expires")} <span className="num font-semibold text-ink">{DUR(o.expires_in)}</span></span>
      </div>
      <h3 className="text-base font-bold leading-snug">{R({ k: "sp.offer.title", v: { company: o.company, area: o.area, zone: o.zone_id } })}</h3>
      <dl className="mt-1.5 space-y-1 text-sm">
        <Row k="sp.when">{R({ k: "sp.offer.when", v: { from: o.start_date, to: o.end_date } })}</Row>
        <Row k="sp.offer.price_label">{R({ k: "sp.offer.price", v: { price: o.price, listing: o.listing_price, day: o.per_day } })}</Row>
      </dl>
      {ev && (
        <ul className="mt-2 space-y-1 rounded-lg bg-surface2 p-2 text-sm" aria-label={T("sp.checks")}>
          {ev.checks.map((c) => (
            <li key={c.key} className="flex items-start gap-2"><span className={`mt-0.5 font-bold ${LEVEL[c.level].cls}`} aria-hidden>{LEVEL[c.level].icon}</span>
              <span><span className="font-semibold">{T(`sp.chk.${c.key}`)}: </span><span className="text-muted">{R(c.msg)}</span><span className="sr-only"> ({T(`sp.level.${c.level}`)})</span></span></li>
          ))}
        </ul>
      )}
      <dl className="mt-2 text-sm"><Row k="dc.ignore" tone="rounded-md bg-high-soft/60 px-2 py-1">{T("sp.offer.ignore")}</Row></dl>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Btn tone="ok" size="lg" disabled={busy || !!blocked} className="grow sm:grow-0" title={blocked ? T("sp.offer.cant_accept") : undefined}
          onClick={() => spaceAct(`/api/space/offers/${o.id}`, { action: "accept" }, { k: "toast.sp.accepted", v: { company: o.company, area: o.area, zone: o.zone_id } })}>{T("sp.btn.accept")}</Btn>
        <Btn disabled={busy} onClick={() => setDlg("counter")}>{T("sp.btn.counter")}</Btn>
        <Btn tone="bad" disabled={busy} onClick={() => setDlg("reject")}>{T("sp.btn.reject")}</Btn>
      </div>
      {blocked && <p className="mt-1.5 text-xs text-muted">{ev.suggest ? R({ k: "sp.offer.try_counter", v: { area: ev.suggest.area } }) : T("sp.offer.cant_accept")}</p>}
      {dlg === "counter" && <CounterDialog o={o} onClose={() => setDlg(null)} />}
      {dlg === "reject" && <RejectDialog o={o} onClose={() => setDlg(null)} />}
    </li>
  );
});

/** A published listing that the company's own approved orders now squeeze: shrink, pause or withdraw it. Active leases are never touched. */
const ConflictCard = memo(function ConflictCard({ c }: { c: Conflict }) {
  const { T, R, DT, DUR, spaceAct, setSection } = useApp();
  const busy = useBusy();
  const tick = useSnap((s) => s.sim.tick);
  const d = c.driver;
  const act = (action: string, area?: number, msg?: string) => spaceAct(`/api/space/listings/${c.listing_id}`, { action, area }, { k: msg ?? "toast.sp.listing_changed", v: { zone: c.zone_id, area: area ?? c.rest } });
  return (
    <li className="rounded-xl border-2 border-high bg-surface p-3.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <Pill tone="High">{T("sp.kind.conflict")}</Pill>
        <span className="text-xs text-muted">{T("dc.waiting")} <span className="num font-semibold text-ink">{DUR(tick - c.since_tick)}</span> · {T("since")} <span className="num">{DT(c.since_tick)}</span></span>
      </div>
      <h3 className="text-base font-bold leading-snug">{R({ k: "sp.conflict.title", v: { zone: c.zone_id, short: c.short, listing: c.rest } })}</h3>
      <dl className="mt-1.5 space-y-1 text-sm">
        <Row k="dc.why">{R({ k: d ? "sp.conflict.why_po" : "sp.conflict.why", v: { po: d?.po_id ?? "", item: d?.item_id ?? "", qty: d?.qty ?? 0, area: d?.area ?? 0, arrival: d?.arrival ?? "", from: c.from, to: c.to } })}</Row>
        <Row k="sp.options">{T("sp.conflict.options")}</Row>
        <Row k="dc.ignore" tone="rounded-md bg-high-soft/60 px-2 py-1">{T("sp.conflict.ignore")}</Row>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {c.can_shrink && <Btn tone="ok" size="lg" disabled={busy} className="grow sm:grow-0" onClick={() => act("shrink", c.shrink_to)}>{R({ k: "sp.btn.shrink", v: { area: c.shrink_to } })}</Btn>}
        <Btn disabled={busy} onClick={() => act("pause")}>{T("sp.btn.pause")}</Btn>
        <Btn tone="bad" disabled={busy} onClick={() => act("withdraw")}>{T("sp.btn.withdraw")}</Btn>
        <button type="button" onClick={() => setSection("purchasing")} className="min-h-10 px-2 text-sm font-semibold text-brand hover:underline">{T("sp.conflict.go_buy")}</button>
      </div>
    </li>
  );
});

/** A published listing nobody answered within the window: lower the price (when it is above the market band), widen dates or area, split, or withdraw. */
const AdviceCard = memo(function AdviceCard({ a }: { a: AdviceT }) {
  const { T, R, DUR, spaceAct } = useApp();
  const busy = useBusy();
  const days = useSnap((s) => s.space.settings.offer_window_days);
  return (
    <li className="rounded-xl border border-line bg-surface p-3.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <Pill tone="Monitor">{T("sp.kind.advice")}</Pill>
        <span className="text-xs text-muted">{T("dc.waiting")} <span className="num font-semibold text-ink">{DUR(a.age)}</span></span>
      </div>
      <h3 className="text-base font-bold leading-snug">{R({ k: "sp.advice.title", v: { zone: a.zone_id, days } })}</h3>
      <dl className="mt-1.5 space-y-1 text-sm">
        <Row k="dc.why">{R({ k: a.high ? "sp.advice.why_high" : "sp.advice.why_ok", v: { price: a.price, market: a.market } })}</Row>
        <Row k="sp.options">{T(a.high ? "sp.advice.opts_high" : "sp.advice.opts_ok")}</Row>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {a.high && <Btn tone="ok" size="lg" disabled={busy} className="grow sm:grow-0" onClick={() => spaceAct(`/api/space/listings/${a.listing_id}`, { action: "reprice", price: a.suggest_price }, { k: "toast.sp.repriced", v: { zone: a.zone_id, price: a.suggest_price } })}>{R({ k: "sp.btn.reprice", v: { price: a.suggest_price } })}</Btn>}
        <Btn tone="bad" disabled={busy} onClick={() => spaceAct(`/api/space/listings/${a.listing_id}`, { action: "withdraw" }, { k: "toast.sp.listing_changed", v: { zone: a.zone_id } })}>{T("sp.btn.withdraw")}</Btn>
      </div>
    </li>
  );
});

/** "Needs your decision" of the Space section: conflicts first, then offers (oldest first), then free windows. Fixed height. */
export default function SpaceQueue() {
  const { T, N, DUR } = useApp();
  const windows = useWindows(), offers = useOffers(), conflicts = useConflicts(), advice = useAdvice();
  const kpi = useSnap((s) => s.space.kpi);
  const pend = useMemo(() => offers.filter((o) => o.status === "PENDING").sort((a, b) => b.age_hours - a.age_hours), [offers]);
  const wins = useMemo(() => windows.filter((w) => w.state === "NEW"), [windows]);
  const total = conflicts.length + pend.length + wins.length + advice.length;
  return (
    <section id="decisions" className="card scroll-mt-24" aria-label={T("sp.queue.title")}>
      <div className="flex min-h-[88px] flex-wrap content-start items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold">{T("sp.queue.title")} <span className={`num rounded-full px-2.5 py-0.5 text-sm ${total ? "bg-high text-on-accent" : "bg-ok-soft text-ok"}`}>{N(total)}</span></h2>
          <p className="line-clamp-2 text-xs text-muted">{total ? `${T("dc.oldest")}: ${DUR(kpi.oldest_age)} · ` : ""}{T("sp.queue.sub")}</p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {conflicts.length > 0 && <Pill tone="High">{T("sp.kind.conflict")} {N(conflicts.length)}</Pill>}
          {pend.length > 0 && <Pill tone="Info" icon={false}>{T("sp.kind.offer")} {N(pend.length)}</Pill>}
          {wins.length > 0 && <Pill tone="RESERVED" icon={false}>{T("sp.kind.window")} {N(wins.length)}</Pill>}
        </div>
      </div>
      <ul className="scroll-thin h-[480px] space-y-3 overflow-y-auto p-3">
        {total === 0 && <li className="h-full"><Empty title={T("sp.queue.empty")} text={T("sp.queue.empty_text")} /></li>}
        {conflicts.map((c) => <ConflictCard key={c.key} c={c} />)}
        {pend.map((o) => <OfferCard key={o.id} o={o} />)}
        {advice.map((a) => <AdviceCard key={`adv-${a.listing_id}`} a={a} />)}
        {wins.map((w) => <WindowCard key={w.key} w={w} />)}
      </ul>
    </section>
  );
}
