"use client";
import { memo, useMemo, useState } from "react";
import { useSnap } from "@/lib/store";
import { useApp } from "./ctx";
import { Empty, ExplainBtn, SevPill, STRIPE } from "./ui";

export function KpiStrip() {
  const { T, N, OMR, D, goTab } = useApp();
  const k = useSnap((s) => s.kpi), ex = useSnap((s) => s.kpi_explain), total = useSnap((s) => s.budget.total);
  const cards = [
    { id: "risk", label: T("kpi.risk"), value: N(k.items_at_risk), sub: T("kpi.risk_sub"), tone: k.items_at_risk > 0 ? "text-crit" : "text-ok", go: () => document.getElementById("risks")?.scrollIntoView({ behavior: "smooth" }), e: ex.risk },
    { id: "budget", label: T("kpi.budget"), value: OMR(k.budget_remaining), sub: `${T("kpi.budget_sub")} ${OMR(total)} · ${T("kpi.budget_renews")} ${D(k.budget_renews)} (${N(k.budget_days_left)} ${T("days")})`, sub2: k.emergency_spend > 0 ? `${T("kpi.emergency")} ${OMR(k.emergency_spend)}` : "", tone: k.over_budget ? "text-crit" : "text-brand", go: () => goTab("plan"), e: ex.budget },
    { id: "orders", label: T("kpi.orders"), value: N(k.po_open), sub: T("kpi.orders_sub"), tone: "text-brand", go: () => goTab("plan"), e: ex.orders },
    { id: "pending", label: T("kpi.pending"), value: N(k.pending), sub: T("kpi.pending_sub"), tone: k.pending > 0 ? "text-high" : "text-ok", go: () => document.getElementById("decisions")?.scrollIntoView({ behavior: "smooth" }), e: ex.pending },
  ];
  return (
    <section className="grid grid-cols-2 gap-3" aria-label={T("kpi.title")}>
      {cards.map((c) => (
        <div key={c.id} className="card min-h-[136px] p-4">
          <div className="flex items-center text-sm font-medium text-muted">{c.label}<ExplainBtn e={c.e} /></div>
          <button type="button" onClick={c.go} className="mt-1 block w-full text-start">
            <div className={`num kpi-value text-xl font-bold leading-tight xl:text-2xl ${c.tone}`}>{c.value}</div>
            <div className="mt-1 text-sm text-muted">{c.sub}</div>
            {"sub2" in c && c.sub2 ? <div className="text-sm font-semibold text-high">{c.sub2 as string}</div> : null}
          </button>
        </div>
      ))}
    </section>
  );
}

export const RiskRow = memo(function RiskRow({ a }: { a: any }) {
  const { T, R, DT } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <li className={`rounded-xl border border-line border-s-4 bg-surface ${STRIPE[a.severity]}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-12 w-full items-start gap-2 p-3 text-start">
        <span className="mt-0.5"><SevPill sev={a.severity} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-snug">{R(a.title)}</span>
          <span className="block text-xs text-muted">{T("since")} <span className="num">{DT(a.since_tick)}</span></span>
        </span>
        <span className="mt-1 text-muted" aria-hidden>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <dl className="space-y-1 border-t border-line px-3 py-2 text-sm">
          <div><dt className="inline font-semibold">{T("dc.why")}: </dt><dd className="inline text-muted">{R(a.detail)}</dd></div>
          <div><dt className="inline font-semibold">{T("dc.todo")}: </dt><dd className="inline text-muted">{T(`alert.prop.${a.kind}`)}</dd></div>
          {a.ignore_msg && <div className="rounded-md bg-high-soft/60 px-2 py-1"><dt className="inline font-semibold text-high">{T("dc.ignore")}: </dt><dd className="inline">{R(a.ignore_msg)}</dd></div>}
        </dl>
      )}
    </li>
  );
});

/** What is at risk: the alerts in plain words; details on click. Fixed height. */
export function RiskList({ flow = "purchasing" }: { flow?: "purchasing" | "space" }) {
  const { T, N } = useApp();
  const all = useSnap((s) => s.alerts);
  const alerts = useMemo(() => all.filter((a) => a.flow === flow || a.flow === "both"), [all, flow]);
  const rows = useMemo(() => alerts.filter((a) => a.severity !== "Info" && a.kind !== "DECISION_OVERDUE"), [alerts]);
  const info = useMemo(() => alerts.filter((a) => a.severity === "Info"), [alerts]);
  const [showInfo, setShowInfo] = useState(false);
  return (
    <section id="risks" className="card scroll-mt-24 flex h-[480px] flex-col" aria-label={T("risk.title")}>
      <div className="border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 text-lg font-bold">{T("risk.title")} <span className="num rounded-full bg-surface2 px-2.5 py-0.5 text-sm">{N(rows.length)}</span></h2>
        <p className="text-xs text-muted">{T("risk.sub")}</p>
      </div>
      <ul className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {rows.length === 0 && <li className="h-full"><Empty title={T("risk.empty")} text={T("risk.empty_text")} /></li>}
        {rows.map((a) => <RiskRow key={a.key} a={a} />)}
        {info.length > 0 && (
          <li>
            <button type="button" onClick={() => setShowInfo((v) => !v)} aria-expanded={showInfo} className="min-h-11 w-full rounded-xl border border-dashed border-line px-3 text-start text-sm font-semibold text-muted hover:text-brand">
              {showInfo ? "▾" : "▸"} {T("risk.too_much")} ({N(info.length)})
            </button>
            {showInfo && <ul className="mt-2 space-y-2">{info.map((a) => <RiskRow key={a.key} a={a} />)}</ul>}
          </li>
        )}
      </ul>
    </section>
  );
}
