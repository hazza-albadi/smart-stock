"use client";
import { memo, useMemo, useState } from "react";
import { useSnap } from "@/lib/store";
import { useApp } from "./ctx";
import { CardHead, ExplainBtn, StatusPill, Term } from "./ui";

const FILTERS = ["all", "Critical", "Low", "Expiring", "Overstock", "OK"] as const;
type Item = ReturnType<typeof useItems>[number];
const useItems = () => useSnap((s) => s.items);

const Row = memo(function Row({ r, onHand, flash }: { r: Item; onHand: number; flash: boolean }) {
  const { T, N, U, name, name2, D, CK, DUR, select } = useApp();
  const lasts = r.lasts_hours === null ? T("stock.no_use") : onHand <= 0 ? T("stock.empty") : `${T("stock.about")} ${DUR(r.lasts_hours)}`;
  return (
    <tr onClick={() => select(r.item_id)} tabIndex={0} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && select(r.item_id)}
      className={`h-[72px] cursor-pointer border-t border-line hover:bg-surface2 ${flash ? "row-flash" : ""}`}>
      <td className="px-3 py-2"><div className="line-clamp-2 text-sm font-semibold leading-tight">{name(r.item_id)}</div><div className="truncate text-xs text-muted">{name2(r.item_id)} · <span className="num">{r.item_id}</span></div></td>
      <td className="px-3 py-2 text-sm font-semibold"><span className="num">{N(onHand)}</span> <span className="text-xs font-normal text-muted">{U(r.unit)}</span></td>
      <td className="px-3 py-2 text-sm"><span className="num">{lasts}</span><ExplainBtn e={r.explain.cover} /></td>
      <td className="px-3 py-2"><StatusPill status={r.status} /></td>
      <td className="hidden px-3 py-2 text-xs sm:table-cell">
        {r.po ? (
          <div><span className="num font-semibold">{N(r.po.qty)}</span> {U(r.unit)}
            <div className={`num ${r.po.delayed ? "font-semibold text-crit" : "text-muted"}`}>{r.po.delayed ? `${T("stock.delayed")} · ` : ""}{D(r.po.eta)} {CK(r.po.hour)}</div></div>
        ) : <span className="text-muted">—</span>}
      </td>
    </tr>
  );
});

export default function StockTable({ flash, shown }: { flash: Record<string, boolean>; shown: Record<string, number> }) {
  const { T, N } = useApp();
  const items = useItems();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const rows = useMemo(() => items.filter((i) => filter === "all" || i.status === filter), [items, filter]);
  const count = (f: string) => (f === "all" ? items.length : items.filter((i) => i.status === f).length);
  return (
    <section className="card flex h-[520px] flex-col overflow-hidden" aria-label={T("stock.title")}>
      <CardHead title={T("stock.title")} sub={T("stock.sub")}
        right={
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={T("stock.filter")}>
            {FILTERS.map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
                className={`min-h-9 rounded-full border px-3 text-xs font-semibold ${filter === f ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface2 hover:border-brand"}`}>
                {T(f === "all" ? "all" : `st.${f}`)} <span className="num opacity-70">{N(count(f))}</span>
              </button>
            ))}
          </div>
        } />
      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[640px] table-fixed border-collapse text-sm">
          <colgroup><col style={{ width: "34%" }} /><col style={{ width: "15%" }} /><col style={{ width: "18%" }} /><col style={{ width: "16%" }} /><col className="hidden sm:table-column" style={{ width: "17%" }} /></colgroup>
          <thead className="sticky top-0 z-10 bg-surface2 text-xs text-muted">
            <tr>
              <th className="px-3 py-2 text-start font-semibold" scope="col">{T("stock.item")}</th>
              <th className="px-3 py-2 text-start font-semibold" scope="col">{T("stock.in_stock")}</th>
              <th className="px-3 py-2 text-start font-semibold" scope="col"><Term k="lasts">{T("stock.lasts")}</Term></th>
              <th className="px-3 py-2 text-start font-semibold" scope="col">{T("stock.status")}</th>
              <th className="hidden px-3 py-2 text-start font-semibold sm:table-cell" scope="col">{T("stock.on_order")}</th>
            </tr>
          </thead>
          <tbody>{rows.map((r) => <Row key={r.item_id} r={r} onHand={shown[r.item_id] ?? r.on_hand} flash={!!flash[r.item_id]} />)}</tbody>
        </table>
        {rows.length === 0 && <div className="p-6 text-center text-sm text-muted">{T("stock.none")}</div>}
      </div>
    </section>
  );
}
