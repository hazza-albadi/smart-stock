"use client";
import { useSnap } from "@/lib/store";
import { useApp } from "./ctx";
import { SevPill } from "./ui";

/** The daily summary written by the coordinator (after 08:00, after "Run analysis" and at the start): everything here was read from the database. */
export default function SummaryCard({ compact = false }: { compact?: boolean }) {
  const { T, R, D, DT } = useApp();
  const s = useSnap((x) => x.summary);
  return (
    <section aria-label={T("sum.title")} className={compact ? "rounded-xl border border-line bg-surface2 p-3" : "border-b border-line bg-surface2 px-4 py-3"}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 className="text-sm font-bold">{T("sum.title")}</h3>
        {s && <span className="text-xs text-muted">{T("sum.as_of")} <span className="num">{D(s.date)}</span> · <span className="num">{DT(s.tick)}</span></span>}
      </div>
      {!s ? <p className="mt-1 min-h-[3.5rem] text-sm text-muted">{T("sum.empty")}</p> : (
        <div className="mt-1.5 grid gap-x-6 gap-y-1.5 text-sm md:min-h-[6.5rem] md:grid-cols-2">
          <div className="min-w-0">
            <p className="font-semibold">{R(s.lines.risks)}</p>
            <ul className="mt-1 space-y-1">
              {s.risks.top.map((r) => <li key={r.key} className="flex items-start gap-2 text-xs"><SevPill sev={r.severity} /><span className="min-w-0 flex-1 leading-relaxed">{R(r.title)}</span></li>)}
            </ul>
          </div>
          <ul className="min-w-0 space-y-1 leading-relaxed">
            <li>{R(s.lines.decisions)}</li>
            <li>{R(s.lines.budget)}</li>
            <li>{R(s.lines.space)}</li>
            <li>{R(s.lines.offers)}</li>
          </ul>
        </div>
      )}
    </section>
  );
}
