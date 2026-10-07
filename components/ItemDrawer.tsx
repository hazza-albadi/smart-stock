"use client";
import { useEffect, useState } from "react";
import { useSnap } from "@/lib/store";
import { useApp } from "./ctx";
import { ExplainBtn, StatusPill, Term } from "./ui";

interface Detail {
  weekly: number[];
  forecast: { forecast_weeks: string } | null;
  lots: { lot_id: string; quantity_on_hand: number; received_date: string; expiry_date: string | null }[];
  pos: { po_id: string; quantity: number; expected_arrival: string; expected_hour: number; status: string }[];
  movements: { date: string; tick: number | null; movement_type: string; quantity: number; reference: string; balance_after: number | null }[];
}

function Spark({ weekly, forecast, label }: { weekly: number[]; forecast: number[]; label: string }) {
  const all = [...weekly, ...forecast];
  const max = Math.max(1, ...all);
  const W = 520, H = 120, pad = 6, bw = (W - pad * 2) / all.length;
  return (
    <svg viewBox={`0 0 ${W} ${H + 4}`} className="w-full" role="img" aria-label={label}>
      <line x1={pad} x2={W - pad} y1={H} y2={H} stroke="var(--line)" />
      {all.map((v, i) => {
        const h = (v / max) * (H - 10), f = i >= weekly.length;
        return <rect key={i} x={pad + i * bw + 1} y={H - h} width={Math.max(2, bw - 2)} height={h} rx={2} fill={f ? "none" : "var(--brand)"} stroke={f ? "var(--high)" : "none"} strokeDasharray={f ? "3 2" : undefined} strokeWidth={f ? 1.6 : 0} opacity={f ? 1 : 0.35 + 0.65 * (i / weekly.length)} />;
      })}
      <line x1={pad + weekly.length * bw} x2={pad + weekly.length * bw} y1={0} y2={H} stroke="var(--muted)" strokeDasharray="2 3" />
    </svg>
  );
}

export default function ItemDrawer({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const { T, N, U, D, CK, DT, DUR, name, name2 } = useApp();
  const items = useSnap((s) => s.items);
  const day = useSnap((s) => s.sim.day);
  const [d, setD] = useState<Detail | null>(null);
  const item = items.find((i) => i.item_id === itemId);
  useEffect(() => {
    let off = false;
    fetch(`/api/items/${itemId}`).then((r) => r.json()).then((j) => !off && setD(j)).catch(() => {});
    return () => { off = true; };
  }, [itemId, day]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  if (!item) return null;
  const fw: number[] = d?.forecast ? JSON.parse(d.forecast.forecast_weeks) : [];
  const stat = (label: React.ReactNode, value: string, e?: any) => <div className="rounded-lg bg-surface2 px-3 py-2"><div className="text-xs text-muted">{label}</div><div className="num text-sm font-bold">{value}{e && <ExplainBtn e={e} />}</div></div>;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={name(itemId)}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="drawer scroll-thin absolute inset-y-0 end-0 w-full max-w-[460px] overflow-y-auto border-s border-line bg-surface p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold leading-tight">{name(itemId)}</h3>
            <div className="mt-0.5 text-xs text-muted">{name2(itemId)} · <span className="num">{item.item_id}</span></div>
            <div className="mt-2"><StatusPill status={item.status} /></div>
          </div>
          <button type="button" onClick={onClose} className="min-h-10 min-w-10 rounded-lg border border-line text-lg hover:border-brand" aria-label={T("close")}>✕</button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {stat(T("stock.in_stock"), `${N(item.on_hand)} ${U(item.unit)}`)}
          {stat(<Term k="lasts">{T("stock.lasts")}</Term>, item.lasts_hours === null ? T("stock.no_use") : `${T("stock.about")} ${DUR(item.lasts_hours)}`, item.explain.cover)}
          {stat(T("drawer.per_week"), `${N(item.weekly_usage, 1)} ${U(item.unit)}`)}
          {stat(<Term k="safety">{T("drawer.safety")}</Term>, `${N(item.safety_stock)} ${U(item.unit)}`)}
          {stat(<Term k="lead">{T("drawer.lead")}</Term>, `${N(item.lead_time_days)} ${T("days")}`)}
          {stat(<Term k="season">{T("drawer.season")}</Term>, `×${N(item.season_factor, 2)}`)}
        </div>
        {item.stockout_hours !== null && <p className="mt-3 rounded-lg bg-high-soft px-3 py-2 text-sm text-high">{T("drawer.runs_out")}: <span className="num font-bold">{DUR(item.stockout_hours)}</span></p>}
        <h4 className="mt-5 text-sm font-bold">{T("drawer.usage")}</h4>
        {d ? <Spark weekly={d.weekly} forecast={fw} label={T("drawer.usage")} /> : <div className="skeleton h-32 rounded-lg" />}
        <p className="text-xs text-muted">{T("drawer.chart_hint")}</p>
        <h4 className="mt-5 text-sm font-bold"><Term k="lot">{T("drawer.lots")}</Term></h4>
        <table className="mt-1 w-full text-sm"><thead className="text-xs text-muted"><tr><th className="py-1 text-start">{T("drawer.lot")}</th><th className="text-start">{T("drawer.qty")}</th><th className="text-start">{T("drawer.expiry")}</th></tr></thead>
          <tbody>{d?.lots.map((l) => <tr key={l.lot_id} className="border-t border-line"><td className="num py-1.5 text-xs">{l.lot_id}</td><td className="num font-semibold">{N(l.quantity_on_hand)}</td><td className="num text-xs">{l.expiry_date ? D(l.expiry_date) : <span className="text-muted">{T("drawer.no_expiry")}</span>}</td></tr>)}</tbody></table>
        <h4 className="mt-5 text-sm font-bold">{T("stock.on_order")}</h4>
        {d && d.pos.length === 0 && <p className="text-sm text-muted">{T("none")}</p>}
        {d?.pos.map((p) => <div key={p.po_id} className="flex justify-between gap-2 border-t border-line py-1.5 text-sm"><span className="num text-xs">{p.po_id}</span><span className="num">{N(p.quantity)} · {D(p.expected_arrival)} {CK(p.expected_hour)} · <span className={p.status === "DELAYED_BY_SUPPLIER" ? "font-semibold text-crit" : "text-muted"}>{T(`po.${p.status}`)}</span></span></div>)}
        <h4 className="mt-5 text-sm font-bold">{T("drawer.recent")}</h4>
        {d?.movements.map((m, i) => <div key={i} className="flex justify-between gap-2 border-t border-line py-1.5 text-xs"><span className="num text-muted">{m.tick !== null ? DT(m.tick) : D(m.date)}</span><span className={`num font-semibold ${m.movement_type === "IN" ? "text-ok" : ""}`}>{m.movement_type === "IN" ? "+" : "−"}{N(m.quantity)}</span><span className="num">{m.balance_after != null ? N(m.balance_after) : ""}</span></div>)}
      </aside>
    </div>
  );
}
