"use client";
import { useState } from "react";
import { tr, nf, catName, unitName, type Lang, type Key } from "@/lib/i18n";
import type { Snapshot } from "@/lib/snapshot";
import { CardHead, CritBadge, Pill, StatusPill, pick } from "./ui";

const FILTERS = ["all", "Critical", "Low", "Expiring", "Overstock", "OK"] as const;

export default function StockTable({ lang, snap, flash, shown, onSelect }: {
  lang: Lang; snap: Snapshot; flash: Record<string, boolean>; shown: Record<string, number>; onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const rows = snap.items.filter((i) => filter === "all" || i.status === filter);
  const count = (f: string) => (f === "all" ? snap.items.length : snap.items.filter((i) => i.status === f).length);

  return (
    <section className="card flex h-[640px] flex-col overflow-hidden" aria-label={tr(lang, "stockTitle")}>
      <CardHead
        title={tr(lang, "stockTitle")}
        right={
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${filter === f ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface2 hover:border-brand"}`}>
                {tr(lang, f === "all" ? "all" : (f as Key))} <span className="num opacity-70">{count(f)}</span>
              </button>
            ))}
          </div>
        }
      />
      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-surface2 text-xs text-muted">
            <tr>
              {(["item", "category", "onHand", "weeklyUsage", "cover", "status", "crit", "openPo"] as Key[]).map((k) => (
                <th key={k} className={`px-3 py-2 text-start font-semibold ${k === "category" ? "hidden md:table-cell" : ""} ${k === "weeklyUsage" ? "hidden sm:table-cell" : ""}`} scope="col">
                  {tr(lang, k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const onHand = shown[r.item_id] ?? r.on_hand;
              const coverW = Math.min(100, (r.weeks_cover / 12) * 100);
              return (
                <tr key={r.item_id} onClick={() => onSelect(r.item_id)} tabIndex={0}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(r.item_id)}
                  className={`cursor-pointer border-t border-line hover:bg-surface2 focus-visible:bg-surface2 ${flash[r.item_id] ? "row-flash" : ""}`}>
                  <td className="px-3 py-2">
                    <div className="font-semibold leading-tight">{pick(lang, r.name_en, r.name_ar)}</div>
                    <div className="text-xs text-muted"><span className="num">{r.item_id}</span> · {lang === "ar" ? r.name_en : r.name_ar}</div>
                  </td>
                  <td className="hidden px-3 py-2 text-muted md:table-cell">{catName(lang, r.category)}</td>
                  <td className="px-3 py-2 font-semibold"><span className="num">{nf(onHand)}</span> <span className="text-xs font-normal text-muted">{unitName(lang, r.unit)}</span></td>
                  <td className="hidden px-3 py-2 sm:table-cell">
                    <span className="num">{nf(r.weekly_usage, r.weekly_usage < 10 ? 1 : 0)}</span>
                    {r.anomaly && <span className="ms-1"><Pill tone="High" title={tr(lang, "anomaly")}>×{r.anomaly_ratio.toFixed(1)}</Pill></span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className="num font-semibold">{r.weeks_cover > 99 ? "99+" : r.weeks_cover.toFixed(1)}</span>
                    <div className="mt-1 h-1 w-16 overflow-hidden rounded bg-line">
                      <div className={`h-full ${r.weeks_cover < 1 ? "bg-crit" : r.weeks_cover < 2 ? "bg-mon" : r.weeks_cover > 20 ? "bg-over" : "bg-ok"}`} style={{ width: `${coverW}%` }} />
                    </div>
                  </td>
                  <td className="px-3 py-2"><StatusPill status={r.status} lang={lang} /></td>
                  <td className="px-3 py-2"><CritBadge c={r.criticality} /></td>
                  <td className="px-3 py-2 text-xs">
                    {r.po ? (
                      <div>
                        <span className="num font-semibold">{nf(r.po.qty)}</span> {unitName(lang, r.unit)}
                        <div className={`num ${r.po.delayed ? "font-semibold text-crit" : "text-muted"}`}>
                          {r.po.delayed ? `${tr(lang, "delayed")} · ` : ""}{r.po.eta}
                        </div>
                      </div>
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
