"use client";
import { useEffect, useState } from "react";
import { useApp } from "./ctx";
import { CritBadge, ExplainBtn, StatusPill } from "./ui";

interface Detail {
  weekly: number[];
  forecast: { forecast_weeks: string } | null;
  lots: { lot_id: string; quantity_on_hand: number; received_date: string; expiry_date: string | null }[];
  pos: { po_id: string; quantity: number; expected_arrival: string; expected_hour: number; status: string }[];
  movements: { date: string; tick: number | null; movement_type: string; quantity: number; reference: string; balance_after: number | null }[];
}

function Spark({ weekly, forecast }: { weekly: number[]; forecast: number[] }) {
  const all = [...weekly, ...forecast];
  const max = Math.max(1, ...all);
  const W = 520, H = 120, pad = 6, bw = (W - pad * 2) / all.length;
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img" aria-label="usage">
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
  const { snap, T, N, U, D, CK, DT, name, name2 } = useApp();
  const [d, setD] = useState<Detail | null>(null);
  const item = snap.items.find((i) => i.item_id === itemId);
  useEffect(() => {
    let off = false;
    fetch(`/api/items/${itemId}`).then((r) => r.json()).then((j) => !off && setD(j)).catch(() => {});
    return () => { off = true; };
  }, [itemId, snap.sim.tick]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  if (!item) return null;
  const fw: number[] = d?.forecast ? JSON.parse(d.forecast.forecast_weeks) : [];
  const stat = (label: string, value: string, e?: any) => <div className="rounded-lg bg-surface2 px-3 py-2"><div className="text-[11px] text-muted">{label}</div><div className="num text-sm font-bold">{value}{e && <ExplainBtn e={e} />}</div></div>;
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={item.name_en}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="drawer scroll-thin absolute inset-y-0 end-0 w-full max-w-[460px] overflow-y-auto border-s border-line bg-surface p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold leading-tight">{name(itemId)}</h3>
            <div className="mt-0.5 text-xs text-muted"><span className="num">{item.item_id}</span> · {name2(itemId)}</div>
            <div className="mt-2 flex items-center gap-2"><StatusPill status={item.status} /><CritBadge c={item.criticality} rank={item.crit_rank} /></div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-line px-2.5 py-1 text-sm hover:border-brand" aria-label={T("close")}>✕</button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {stat(T("onHand"), `${N(item.on_hand)} ${U(item.unit)}`)}
          {stat(T("cover"), item.weeks_cover > 99 ? "99+" : N(item.weeks_cover, 1), item.explain.cover)}
          {stat(T("weeklyUsage"), N(item.weekly_usage, 1))}
          {stat(T("safety"), N(item.safety_stock))}
          {stat(T("leadTime"), `${N(item.lead_time_days)} ${T("days")}`)}
          {stat(T("season"), `×${N(item.season_factor, 2)}`)}
        </div>
        {item.stockout_hours !== null && <p className="mt-3 rounded-lg bg-high-soft px-3 py-2 text-sm text-high">{T("stockoutIn")}: <span className="num font-bold">{N(item.stockout_hours)}</span> {T("u.h")}</p>}
        <h4 className="mt-5 text-sm font-bold">{T("drawerUsage")}</h4>
        {d ? <Spark weekly={d.weekly} forecast={fw} /> : <div className="h-36 animate-pulse rounded-lg bg-surface2" />}
        {fw.length > 0 && <p className="text-xs text-muted">{T("drawerForecast")}: {fw.map((v, i) => <span key={i} className="num me-2 font-semibold text-ink">{N(v)}</span>)}</p>}
        <h4 className="mt-5 text-sm font-bold">{T("lots")}</h4>
        <table className="mt-1 w-full text-sm"><thead className="text-xs text-muted"><tr><th className="py-1 text-start">{T("lot")}</th><th className="text-start">{T("qty")}</th><th className="text-start">{T("expiry")}</th></tr></thead>
          <tbody>{d?.lots.map((l) => <tr key={l.lot_id} className="border-t border-line"><td className="num py-1.5 text-xs">{l.lot_id}</td><td className="num font-semibold">{N(l.quantity_on_hand)}</td><td className="num text-xs">{l.expiry_date ? D(l.expiry_date) : <span className="text-muted">{T("noExpiry")}</span>}</td></tr>)}</tbody></table>
        <h4 className="mt-5 text-sm font-bold">{T("openPo")}</h4>
        {d && d.pos.length === 0 && <p className="text-sm text-muted">{T("none")}</p>}
        {d?.pos.map((p) => <div key={p.po_id} className="flex justify-between border-t border-line py-1.5 text-sm"><span className="num text-xs">{p.po_id}</span><span className="num">{N(p.quantity)} · {D(p.expected_arrival)} {CK(p.expected_hour)} · <span className={p.status === "DELAYED_BY_SUPPLIER" ? "font-semibold text-crit" : "text-muted"}>{T(`po.${p.status}`)}</span></span></div>)}
        <h4 className="mt-5 text-sm font-bold">{T("recent")}</h4>
        {d?.movements.map((m, i) => <div key={i} className="flex justify-between gap-2 border-t border-line py-1.5 text-xs"><span className="num text-muted">{m.tick !== null ? DT(m.tick) : D(m.date)}</span><span className={`num font-semibold ${m.movement_type === "IN" ? "text-ok" : ""}`}>{m.movement_type === "IN" ? "+" : "−"}{N(m.quantity)}</span><span className="num">{m.balance_after != null ? N(m.balance_after) : ""}</span></div>)}
      </aside>
    </div>
  );
}
