"use client";
import { useSnap } from "@/lib/store";
import { useApp } from "./ctx";

/** The two flows of the app, each with its own screen: Purchasing (stock and orders) and Space (renting out free warehouse space). */
export default function SectionNav() {
  const { T, N, section, setSection } = useApp();
  const buy = useSnap((s) => s.recs.filter((r) => r.status === "PENDING" && !r.snoozed).length) ?? 0;
  const space = useSnap((s) => s.space.kpi.waiting) ?? 0;
  const items: { id: "purchasing" | "space"; label: string; sub: string; n: number }[] = [
    { id: "purchasing", label: T("nav.purchasing"), sub: T("nav.purchasing_sub"), n: buy },
    { id: "space", label: T("nav.space_flow"), sub: T("nav.space_sub"), n: space },
  ];
  return (
    <nav aria-label={T("nav.sections")} className="mx-auto max-w-[1500px] px-3 pt-3 sm:px-4">
      <div role="tablist" className="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-surface p-1.5 shadow-sm">
        {items.map((i) => (
          <button key={i.id} role="tab" type="button" aria-selected={section === i.id} onClick={() => setSection(i.id)} id={`section-${i.id}`}
            className={`flex min-h-14 items-center justify-between gap-3 rounded-xl px-4 text-start transition ${section === i.id ? "bg-brand text-brand-ink shadow" : "text-ink hover:bg-surface2"}`}>
            <span className="min-w-0">
              <span className="block text-base font-bold leading-tight">{i.label}</span>
              <span className={`hidden truncate text-xs sm:block ${section === i.id ? "opacity-90" : "text-muted"}`}>{i.sub}</span>
            </span>
            <span className={`num shrink-0 rounded-full px-2.5 py-0.5 text-sm font-bold ${section === i.id ? "bg-white/25" : i.n ? "bg-high text-on-accent" : "bg-ok-soft text-ok"}`} aria-label={`${T("nav.waiting")}: ${N(i.n)}`}>{N(i.n)}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
