"use client";
import { useApp } from "./ctx";
import { ExplainBtn } from "./ui";

export default function KpiStrip() {
  const { snap, T, N, OMR } = useApp();
  const k = snap.kpi, ex = snap.kpi_explain;
  const cards = [
    { label: T("kpiRisk"), value: N(k.items_at_risk), sub: T("kpiRiskSub"), tone: k.items_at_risk > 0 ? "text-crit" : "text-ok", anchor: "alerts", e: ex.risk },
    { label: T("kpiBudget"), value: OMR(k.budget_remaining), sub: `${T("kpiBudgetSub")} ${OMR(snap.budget.total)}${k.over_budget ? " · " + T("overBudget") : ""}`, tone: k.over_budget ? "text-crit" : "text-brand", anchor: "plan", e: ex.budget },
    { label: T("kpiSpace"), value: `${N(k.rentable_m2)} ${T("fmt.m2")}`, sub: k.reserved_m2 > 0 ? `${T("kpiSpaceReserved")} ${N(k.reserved_m2)} ${T("fmt.m2")}` : T("kpiSpaceSub"), tone: "text-brand", anchor: "space", e: ex.rentable },
    { label: T("kpiPending"), value: N(k.pending), sub: T("kpiPendingSub"), tone: k.pending > 0 ? "text-high" : "text-ok", anchor: "pending", e: ex.pending },
  ];
  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="KPIs">
      {cards.map((c) => (
        <div key={c.label} className="card p-4 transition hover:border-brand">
          <div className="flex items-center text-xs font-medium text-muted">{c.label}<ExplainBtn e={c.e} /></div>
          <a href={`#${c.anchor}`} className="block">
            <div className={`num mt-1 text-2xl font-bold leading-none sm:text-3xl ${c.tone}`}>{c.value}</div>
            <div className="mt-1.5 text-xs text-muted">{c.sub}</div>
          </a>
        </div>
      ))}
    </section>
  );
}
