"use client";
import { tr, nf, type Lang } from "@/lib/i18n";
import type { Snapshot } from "@/lib/snapshot";

export default function KpiStrip({ lang, snap }: { lang: Lang; snap: Snapshot }) {
  const k = snap.kpi;
  const cards = [
    { label: tr(lang, "kpiRisk"), value: nf(k.items_at_risk), sub: tr(lang, "kpiRiskSub"), tone: k.items_at_risk > 0 ? "text-crit" : "text-ok", anchor: "alerts" },
    { label: tr(lang, "kpiBudget"), value: nf(k.budget_remaining), sub: `${tr(lang, "kpiBudgetSub")} ${nf(snap.budget.total)}`, tone: "text-brand", anchor: "plan" },
    { label: tr(lang, "kpiSpace"), value: nf(k.rentable_m2), sub: tr(lang, "kpiSpaceSub"), tone: "text-brand", anchor: "space" },
    { label: tr(lang, "kpiPending"), value: nf(k.pending), sub: tr(lang, "kpiPendingSub"), tone: k.pending > 0 ? "text-high" : "text-ok", anchor: "alerts" },
  ];
  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="KPIs">
      {cards.map((c) => (
        <a key={c.label} href={`#${c.anchor}`} className="card block p-4 transition hover:border-brand">
          <div className="text-xs font-medium text-muted">{c.label}</div>
          <div className={`num mt-1 text-3xl font-bold leading-none ${c.tone}`}>{c.value}</div>
          <div className="mt-1.5 text-xs text-muted">{c.sub}</div>
        </a>
      ))}
    </section>
  );
}
