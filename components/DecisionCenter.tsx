"use client";
import { memo, useMemo, useState } from "react";
import { useSnap } from "@/lib/store";
import { useApp, useBusy } from "./ctx";
import { Btn, Empty, Pill, QtyEdit, Skeleton } from "./ui";
import SupplierMessage from "./SupplierMessage";

type Rec = ReturnType<typeof useRecs>[number];
const useRecs = () => useSnap((s) => s.recs);

/** One recommendation as a card: what, when, why, what to do (one main button), what happens after, what happens if ignored. */
const DecisionCard = memo(function DecisionCard({ rec, ignoreMsg, postponeHours }: { rec: Rec; ignoreMsg: any; postponeHours: number }) {
  const { T, R, N, D, DT, DUR, name, decide, postpone, editQty } = useApp();
  const busy = useBusy();
  const [more, setMore] = useState(false);
  const p = rec.payload;
  let title = "", why = "", after = "", ignore = "", primary = "", reject = T("dc.reject"), kindLabel = T(`kind.${rec.kind}`);
  const warn = useSnap((s) => s.space.po_warnings.find((w) => rec.kind === "PO" && w.item_id === rec.item_id));
  const fund: string = p.funding ?? "FUNDED", fi = p.funding_info ?? null;
  const emergency = rec.kind === "PO" && fund === "NEEDS_EXTRA", deferred = rec.kind === "PO" && fund === "DEFERRED";
  if (rec.kind === "PO") {
    title = R({ k: emergency ? "dc.emerg.title" : "dc.po.title", v: { qty: p.qty, unit: p.unit, item: rec.item_id } });
    why = R(p.reason);
    after = emergency ? R({ k: "dc.emerg.after", v: { extra: fi?.extra ?? 0, cost: p.cost, date: p.expected_arrival } })
      : deferred ? R({ k: "dc.defer.after", v: { date: fi?.renewal_date ?? "", cost: p.cost } }) : R({ k: "dc.po.after", v: { date: p.expected_arrival, cost: p.cost } });
    ignore = emergency ? R({ k: p.stockout ? "dc.emerg.ignore" : "dc.emerg.ignore_nodate", v: { item: rec.item_id, date: p.stockout?.date ?? "", hours: p.stockout?.hours ?? 0 } })
      : ignoreMsg ? R(ignoreMsg) : R({ k: "dc.po.ignore" });
    primary = emergency ? R({ k: "dc.emerg.approve", v: { amount: fi?.extra ?? 0 } }) : deferred ? R({ k: "dc.defer.wait", v: { date: fi?.renewal_date ?? "" } })
      : R({ k: "dc.po.approve", v: { qty: p.qty, unit: p.unit, cost: p.cost } });
  } else if (rec.kind === "SUPPLIER_MSG") {
    title = R({ k: "dc.msg.title", v: { supplier: p.supplier_name, item: rec.item_id } });
    why = R(p.subject);
    after = R({ k: "dc.msg.after" });
    ignore = ignoreMsg ? R(ignoreMsg) : R({ k: "dc.msg.ignore" });
    primary = R({ k: "dc.msg.approve" });
  }
  return (
    <li className={`rounded-xl border bg-surface p-3.5 ${rec.overdue ? "border-high" : "border-line"}`}>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <Pill tone={emergency ? "Critical" : rec.kind === "PO" ? "Info" : "Monitor"} icon={emergency}>{emergency ? T("fund.NEEDS_EXTRA") : kindLabel}</Pill>
        {rec.kind === "PO" && fund !== "FUNDED" && !emergency && <Pill tone={fund === "DEFERRED" ? "High" : "Monitor"}>{T(`fund.${fund}`)}{fund === "DEFERRED" && fi?.renewal_date ? <> · <span className="num">{D(fi.renewal_date)}</span></> : null}</Pill>}
        {rec.source === "manual" && <Pill tone="user" icon={false}>{T("you")}</Pill>}
        {rec.reopen_count > 0 && <Pill tone="High">{T("dc.back")}</Pill>}
        {rec.overdue && <Pill tone="Critical">{T("dc.overdue")}</Pill>}
        <span className="text-xs text-muted">{T("dc.waiting")} <span className="num font-semibold text-ink">{DUR(rec.age_hours)}</span> · {T("since")} <span className="num">{DT(rec.created_tick)}</span></span>
      </div>
      <h3 className="text-base font-bold leading-snug">{title}</h3>
      {warn && <p className="mt-1.5 rounded-md bg-mon-soft px-2 py-1 text-sm"><strong className="text-mon">▲ {T("dc.po.space_warn_h")}: </strong>{R({ k: "dc.po.space_warn", v: { short: warn.short, area: warn.rest, zone: warn.zone_id, date: warn.arrival } })}</p>}
      <dl className="mt-1.5 space-y-1 text-sm">
        <div><dt className="inline font-semibold">{T("dc.why")}: </dt><dd className="inline text-muted">{why}</dd></div>
        <div><dt className="inline font-semibold">{T("dc.after")}: </dt><dd className="inline text-muted">{after}</dd></div>
        <div className="rounded-md bg-high-soft/60 px-2 py-1"><dt className="inline font-semibold text-high">{T("dc.ignore")}: </dt><dd className="inline">{ignore}</dd></div>
      </dl>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {deferred
          ? <Btn tone="primary" size="lg" disabled={busy} className="grow sm:grow-0" onClick={() => postpone(rec.id, fi?.renewal_tick)}>{primary}</Btn>
          : <Btn tone={emergency ? "bad" : "ok"} size="lg" disabled={busy || (emergency && !fi?.within_limit)} className="grow sm:grow-0" title={emergency && !fi?.within_limit ? T("dc.emerg.limit_hint") : undefined} onClick={() => decide(rec.id, "APPROVED")}>{primary}</Btn>}
        {emergency && fi?.max_qty_in_limit > 0 && fi.max_qty_in_limit < p.qty && <Btn disabled={busy} onClick={() => editQty(rec.id, fi.max_qty_in_limit)}>{R({ k: "dc.emerg.reduce", v: { qty: fi.max_qty_in_limit, unit: p.unit, cost: fi.max_cost_in_limit } })}</Btn>}
        {(emergency || deferred) && fi?.small_qty > 0 && fi.small_qty < p.qty && <Btn disabled={busy} onClick={() => decide(rec.id, "APPROVED", { qty: fi.small_qty })}>{R({ k: "dc.fund.small", v: { qty: fi.small_qty, unit: p.unit, cost: fi.small_cost } })}</Btn>}
        <Btn tone="bad" disabled={busy} onClick={() => decide(rec.id, "REJECTED")}>{reject}</Btn>
        {!deferred && !emergency && <Btn disabled={busy} onClick={() => postpone(rec.id)} title={T("dc.postpone_hint")}>{R({ k: "dc.postpone", v: { hours: postponeHours } })}</Btn>}
        {(rec.kind === "PO" || rec.kind === "SUPPLIER_MSG") && (
          <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="min-h-10 px-2 text-sm font-semibold text-brand hover:underline">
            {more ? T("dc.less") : T("dc.details")}
          </button>
        )}
      </div>
      {more && rec.kind === "PO" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-surface2 p-2 text-sm">
          <span className="font-semibold">{T("dc.change_qty")}:</span><QtyEdit rec={rec} /><span className="text-muted">{R({ k: "dc.item_line", v: { item: rec.item_id } })} · {T("dc.supplier_lead")} <span className="num">{N(p.lead_days)}</span> {T("days")}</span>
        </div>
      )}
      {more && rec.kind === "SUPPLIER_MSG" && <SupplierMessage payload={p} />}
      {(emergency || deferred) && fi?.alt_item && <p className="mt-2 rounded-md bg-surface2 px-2 py-1 text-sm text-muted">{R({ k: "dc.fund.alt", v: { item: fi.alt_item } })}</p>}
    </li>
  );
});

/** "Needs your decision": the first thing on the screen. Fixed height so nothing below it moves when cards come and go. */
export default function DecisionCenter() {
  const { T, N, DUR } = useApp();
  const recs = useRecs();
  const alerts = useSnap((s) => s.alerts);
  const hours = useSnap((s) => s.sim.postpone_hours);
  const [showPostponed, setShowPostponed] = useState(false);
  const pending = useMemo(() => recs.filter((r) => r.status === "PENDING"), [recs]);
  const open = useMemo(() => pending.filter((r) => !r.snoozed).sort((a, b) => Number(b.payload.funding === "NEEDS_EXTRA") - Number(a.payload.funding === "NEEDS_EXTRA") || Number(b.overdue) - Number(a.overdue) || b.age_hours - a.age_hours), [pending]);
  const postponed = useMemo(() => pending.filter((r) => r.snoozed), [pending]);
  const ignoreFor = (r: Rec) => alerts.find((a) => a.item_id && a.item_id === r.item_id && a.ignore_msg && ["STOCKOUT", "DELAYED_PO", "SAFETY_LOW"].includes(a.kind))?.ignore_msg ?? null;
  const oldest = open.reduce((m, r) => Math.max(m, r.age_hours), 0);
  const shown = showPostponed ? postponed : open;
  return (
    <section id="decisions" className="card scroll-mt-24" aria-label={T("dc.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold">{T("dc.title")} <span className={`num rounded-full px-2.5 py-0.5 text-sm ${open.length ? "bg-high text-on-accent" : "bg-ok-soft text-ok"}`}>{N(open.length)}</span></h2>
          <p className="text-xs text-muted">{open.length ? `${T("dc.oldest")}: ${DUR(oldest)} · ${T("dc.sub")}` : T("dc.sub")}</p>
        </div>
        {postponed.length > 0 && (
          <Btn onClick={() => setShowPostponed((v) => !v)}>{showPostponed ? T("dc.back_to_open") : `${T("dc.show_postponed")} (${N(postponed.length)})`}</Btn>
        )}
      </div>
      <ul className="scroll-thin h-[480px] space-y-3 overflow-y-auto p-3">
        {shown.length === 0 && <li className="h-full"><Empty title={showPostponed ? T("dc.empty_postponed") : T("dc.empty")} text={showPostponed ? undefined : T("dc.empty_text")} /></li>}
        {shown.map((r) => <DecisionCard key={r.id} rec={r} ignoreMsg={ignoreFor(r)} postponeHours={hours} />)}
      </ul>
    </section>
  );
}

export const DecisionSkeleton = () => <div className="card p-4"><Skeleton h={24} w="40%" /><div className="mt-3 space-y-3"><Skeleton h={110} /><Skeleton h={110} /></div></div>;
