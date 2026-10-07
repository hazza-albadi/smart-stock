"use client";
import { memo } from "react";
import { useSnap } from "@/lib/store";
import { useApp } from "./ctx";
import { Empty, ExplainBtn, Pill, Btn } from "./ui";

const Zone = memo(function Zone({ z }: { z: any }) {
  const { T, N } = useApp();
  const cap = z.capacity;
  const used = Math.min(z.used, cap), reserved = Math.min(z.reserved, Math.max(0, cap - used));
  const alloc = Math.min(z.allocated, Math.max(0, cap - used - reserved));
  const rent = Math.max(0, Math.min(z.net, cap - used - reserved - alloc));
  const locked = Math.max(0, cap - used - reserved - alloc - rent);
  const w = (v: number) => `${(v / cap) * 100}%`;
  const label = T(`zname.${z.zone_name}`) === `zname.${z.zone_name}` ? z.zone_name : T(`zname.${z.zone_name}`);
  return (
    <li>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm"><span className="font-semibold">{label}</span><span className="num text-xs text-muted">{N(z.used)} / {N(z.capacity)} {T("fmt.m2")}</span></div>
      <div className={`flex h-6 w-full overflow-hidden rounded-md bg-surface2 ${z.over_capacity > 1 ? "ring-2 ring-crit" : "ring-1 ring-line"}`} role="img" aria-label={`${label}: ${T("space.used")} ${N(used)}, ${T("space.rentable")} ${N(z.net)}`}>
        <div style={{ width: w(used), background: "var(--seg-used)" }} /><div style={{ width: w(reserved), background: "var(--seg-reserved)" }} />
        <div style={{ width: w(alloc), background: "var(--seg-alloc)" }} /><div style={{ width: w(rent), background: "var(--seg-rent)" }} /><div style={{ width: w(locked), background: "var(--seg-locked)" }} />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted">
        {z.rent_allowed ? <span className="font-semibold text-brand">{T("space.free_to_rent")}: <span className="num">{N(z.net)}</span> {T("fmt.m2")}</span> : <span>{T("space.not_for_rent")}</span>}
        {z.allocated > 0 && <span className="text-over">{T("space.rented")}: <span className="num">{N(z.allocated)}</span></span>}
        {z.over_capacity > 1 && <span className="font-semibold text-crit">⚠ {T("space.over")}: <span className="num">{N(z.over_capacity)}</span></span>}
        <ExplainBtn e={z.explain} />
      </div>
    </li>
  );
});

export default function SpacePanel() {
  const { T, N, R, D, DT } = useApp();
  const zones = useSnap((s) => s.zones), leases = useSnap((s) => s.leases), requests = useSnap((s) => s.requests), recs = useSnap((s) => s.recs);
  const total = useSnap((s) => s.kpi.rentable_m2), ex = useSnap((s) => s.kpi_explain.rentable);
  const spaceRecs = new Map(recs.filter((r) => r.kind === "SPACE").map((r) => [r.request_id, r]));
  const legend: [string, string][] = [["var(--seg-used)", "space.used"], ["var(--seg-reserved)", "space.buffer"], ["var(--seg-alloc)", "space.rented"], ["var(--seg-rent)", "space.free_to_rent"], ["var(--seg-locked)", "space.not_for_rent"]];
  return (
    <div className="grid h-[560px] grid-cols-1 lg:grid-cols-5">
      <div className="scroll-thin min-w-0 overflow-y-auto border-b border-line p-4 lg:col-span-2 lg:border-b-0 lg:border-e">
        <div className="mb-3 rounded-xl bg-brand-soft px-4 py-2 text-center">
          <div className="text-xs text-muted">{T("space.total")}<ExplainBtn e={ex} /></div>
          <div className="text-2xl font-bold text-brand"><span className="num">{N(total)}</span> <span className="text-sm font-semibold">{T("fmt.m2")}</span></div>
        </div>
        <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">{legend.map(([c, k]) => <span key={k} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} aria-hidden />{T(k)}</span>)}</div>
        <ul className="space-y-4">{zones.map((z) => <Zone key={z.zone_id} z={z} />)}</ul>
      </div>
      <div className="scroll-thin min-w-0 overflow-y-auto p-4 lg:col-span-3">
        <h3 className="mb-2 text-sm font-bold">{T("space.requests")}</h3>
        <ul className="space-y-2">
          {requests.map((r) => {
            const rec = spaceRecs.get(r.request_id); const p = rec?.payload;
            return (
              <li key={r.request_id} className="rounded-xl border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{r.company}</span>
                  {rec && <Pill tone={rec.status === "PENDING" ? "PENDING" : rec.status}>{rec.status === "PENDING" ? T("space.waiting") : T(rec.status === "APPROVED" ? "approved" : "rejected")}</Pill>}
                </div>
                <div className="text-xs text-muted">{T("space.needs")} <span className="num font-semibold text-ink">{N(r.area_needed_m2)}</span> {T("fmt.m2")} · <span className="num">{N(r.duration_months)}</span> {T("space.months")} · {T("fmt.from")} <span className="num">{D(r.needed_from)}</span></div>
                {p && rec.status === "PENDING" && <p className="mt-1 text-muted">{R(p.reason)}</p>}
                {p && rec.status === "PENDING" && <button type="button" onClick={() => document.getElementById("decisions")?.scrollIntoView({ behavior: "smooth" })} className="mt-1 min-h-9 text-sm font-semibold text-brand hover:underline">{T("space.decide_above")}</button>}
              </li>
            );
          })}
        </ul>
        <h3 className="mb-2 mt-5 text-sm font-bold">{T("space.leases")}</h3>
        {leases.length === 0 ? <Empty icon="▭" title={T("space.no_leases")} text={T("space.no_leases_text")} /> : (
          <ul className="space-y-1.5">
            {leases.map((l) => (
              <li key={l.id} className="rounded-lg bg-surface2 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2"><span className="font-semibold">{l.company}</span><Pill tone={l.status}>{T(`lease.${l.status}`)}</Pill></div>
                <div className="text-xs text-muted"><span className="num">{N(l.area)}</span> {T("fmt.m2")} · <span className="num">{D(l.start_date)}</span> → <span className="num">{D(l.end_date)}</span></div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
void Btn;
