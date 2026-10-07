"use client";
import { useState } from "react";
import { useApp } from "./ctx";
import { CardHead, CritBadge, ExplainBtn, Pill, StatusPill } from "./ui";

const FILTERS = ["all", "Critical", "Low", "Expiring", "Overstock", "OK"] as const;

export default function StockTable({ flash, shown }: { flash: Record<string, boolean>; shown: Record<string, number> }) {
  const { snap, T, N, U, name, name2, D, CK, select } = useApp();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const rows = snap.items.filter((i) => filter === "all" || i.status === filter);
  const count = (f: string) => (f === "all" ? snap.items.length : snap.items.filter((i) => i.status === f).length);

  return (
    <section className="card flex h-[640px] flex-col overflow-hidden" aria-label={T("stockTitle")}>
      <CardHead title={T("stockTitle")}
        right={
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${filter === f ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface2 hover:border-brand"}`}>
                {T(f === "all" ? "all" : `st.${f}`)} <span className="num opacity-70">{N(count(f))}</span>
              </button>
            ))}
          </div>
        } />
      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface2 text-xs text-muted">
            <tr>
              {["item", "category", "onHand", "weeklyUsage", "cover", "status", "crit", "openPo"].map((k) => (
                <th key={k} className={`px-3 py-2 text-start font-semibold ${k === "category" ? "hidden md:table-cell" : ""} ${k === "weeklyUsage" ? "hidden sm:table-cell" : ""}`} scope="col">{T(k)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const onHand = shown[r.item_id] ?? r.on_hand;
              const coverW = Math.min(100, (r.weeks_cover / 12) * 100);
              return (
                <tr key={r.item_id} onClick={() => select(r.item_id)} tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && select(r.item_id)}
                  className={`cursor-pointer border-t border-line hover:bg-surface2 focus-visible:bg-surface2 ${flash[r.item_id] ? "row-flash" : ""}`}>
                  <td className="px-3 py-2"><div className="font-semibold leading-tight">{name(r.item_id)}</div><div className="text-xs text-muted"><span className="num">{r.item_id}</span> · {name2(r.item_id)}</div></td>
                  <td className="hidden px-3 py-2 text-muted md:table-cell">{T(`cat.${r.category}`) === `cat.${r.category}` ? r.category : T(`cat.${r.category}`)}</td>
                  <td className="px-3 py-2 font-semibold"><span className="num">{N(onHand)}</span> <span className="text-xs font-normal text-muted">{U(r.unit)}</span></td>
                  <td className="hidden px-3 py-2 sm:table-cell">
                    <span className="num">{N(r.weekly_usage, r.weekly_usage < 10 ? 1 : 0)}</span>
                    {r.anomaly && <span className="ms-1"><Pill tone="High" title={T("anomaly")}>×{N(r.anomaly_ratio, 1)}</Pill></span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className="num font-semibold">{r.weeks_cover > 99 ? "99+" : N(r.weeks_cover, 1)}</span><ExplainBtn e={r.explain.cover} />
                    <div className="mt-1 h-1 w-16 overflow-hidden rounded bg-line"><div className={`h-full ${r.weeks_cover < 1 ? "bg-crit" : r.weeks_cover < 2 ? "bg-mon" : r.weeks_cover > 20 ? "bg-over" : "bg-ok"}`} style={{ width: `${coverW}%` }} /></div>
                  </td>
                  <td className="px-3 py-2"><StatusPill status={r.status} /><ExplainBtn e={r.explain.status} /></td>
                  <td className="px-3 py-2"><CritBadge c={r.criticality} rank={r.crit_rank} /></td>
                  <td className="px-3 py-2 text-xs">
                    {r.po ? (
                      <div><span className="num font-semibold">{N(r.po.qty)}</span> {U(r.unit)}
                        <div className={`num ${r.po.delayed ? "font-semibold text-crit" : "text-muted"}`}>{r.po.delayed ? `${T("delayed")} · ` : ""}{D(r.po.eta)} {CK(r.po.hour)}</div></div>
                    ) : <span className="text-muted">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
