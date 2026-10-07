"use client";
import { useState } from "react";
import { useApp } from "./ctx";
import { ApprovalButtons, Btn, ExplainBtn, Pill } from "./ui";

export default function SpacePanel() {
  const { snap, T, N, R, D, decide, busy } = useApp();
  const [area, setArea] = useState<Record<number, string>>({});
  const spaceRecs = new Map(snap.recs.filter((r) => r.kind === "SPACE").map((r) => [r.request_id, r]));
  const total = snap.kpi.rentable_m2;
  const zn = (z: { zone_name: string }) => (T(`zname.${z.zone_name}`) === `zname.${z.zone_name}` ? z.zone_name : T(`zname.${z.zone_name}`));

  const segs = (z: (typeof snap.zones)[number]) => {
    const cap = z.capacity;
    const used = Math.min(z.used, cap);
    const reserved = Math.min(z.reserved, Math.max(0, cap - used));
    const alloc = Math.min(z.allocated, Math.max(0, cap - used - reserved));
    const rentNet = Math.max(0, Math.min(z.net, cap - used - reserved - alloc));
    return { cap, used, reserved, alloc, rentNet, locked: Math.max(0, cap - used - reserved - alloc - rentNet) };
  };
  const legend: [string, string][] = [["var(--seg-used)", "usedZ"], ["var(--seg-reserved)", "reservedZ"], ["var(--seg-alloc)", "allocatedZ"], ["var(--seg-rent)", "rentableZ"], ["var(--seg-locked)", "lockedZ"]];
  const pendApprove = snap.recs.filter((r) => r.kind === "SPACE" && r.status === "PENDING" && r.payload.decision === "APPROVE");
  const afterNote = (() => {
    if (!pendApprove.length) return "";
    const left = snap.zones.filter((z) => z.rent_allowed).map((z) => {
      const t = pendApprove.flatMap((r) => r.payload.allocations as { zone_id: string; area: number }[]).filter((a) => a.zone_id === z.zone_id).reduce((s, a) => s + a.area, 0);
      return { z: z.zone_id, v: Math.max(0, z.net - t) };
    });
    return `${T("space.afterNote")} ${pendApprove.map((r) => r.request_id).join(" + ")}: ${N(left.reduce((s, x) => s + x.v, 0))} ${T("fmt.m2")} (${left.map((x) => `${x.z} ${N(x.v)}`).join(" · ")})`;
  })();

  return (
    <section id="space" className="card scroll-mt-28 overflow-hidden border-brand/40" aria-label={T("spaceTitle")}>
      <div className="border-b border-line bg-brand-soft px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-lg font-bold">{T("spaceTitle")}</h2><p className="text-xs text-muted">{T("spaceSub")}</p></div>
          <div className="rounded-xl bg-surface px-4 py-2 text-center ring-1 ring-line">
            <div className="text-[11px] text-muted">{T("totalRentable")}<ExplainBtn e={snap.kpi_explain.rentable} /></div>
            <div className="text-2xl font-bold text-brand"><span className="num">{N(total)}</span> <span className="text-sm font-semibold">{T("fmt.m2")}</span></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-0 lg:grid-cols-5">
        <div className="min-w-0 border-b border-line p-4 lg:col-span-2 lg:border-b-0 lg:border-e">
          <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">{legend.map(([c, k]) => <span key={k} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{T(k)}</span>)}</div>
          <ul className="space-y-4">
            {snap.zones.map((z) => {
              const s = segs(z), w = (v: number) => `${(v / s.cap) * 100}%`;
              return (
                <li key={z.zone_id}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm"><span className="font-semibold"><span className="num">{z.zone_id}</span> · {zn(z)}</span><span className="num text-xs text-muted">{N(z.used)} / {N(z.capacity)} {T("fmt.m2")}</span></div>
                  <div className={`flex h-6 w-full overflow-hidden rounded-md bg-surface2 ${z.over_capacity > 1 ? "ring-2 ring-crit" : "ring-1 ring-line"}`} role="img" aria-label={`${z.zone_id}: ${T("usedZ")} ${N(s.used)}, ${T("rentableZ")} ${N(z.net)}`}>
                    <div className="transition-all duration-500" style={{ width: w(s.used), background: "var(--seg-used)" }} />
                    <div className="transition-all duration-500" style={{ width: w(s.reserved), background: "var(--seg-reserved)" }} />
                    <div className="transition-all duration-500" style={{ width: w(s.alloc), background: "var(--seg-alloc)" }} />
                    <div className="transition-all duration-500" style={{ width: w(s.rentNet), background: "var(--seg-rent)" }} />
                    <div className="transition-all duration-500" style={{ width: w(s.locked), background: "var(--seg-locked)" }} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-muted">
                    <span>{T("usedZ")} <span className="num">{N(z.used)}</span></span>
                    <span>{T("reservedZ")} <span className="num">{N(z.reserved)}</span></span>
                    {z.rent_allowed ? <span className="font-semibold text-brand">{T("rentableZ")}: <span className="num">{N(z.net)}</span> {T("fmt.m2")}</span> : <span>{T("lockedZ")} <span className="num">{N(z.not_rentable)}</span> ({T("noRent")})</span>}
                    {z.allocated > 0 && <span className="text-over">{T("allocatedZ")}: <span className="num">{N(z.allocated)}</span></span>}
                    {z.over_capacity > 1 && <span className="font-semibold text-crit">⚠ {T("overZ")}: <span className="num">{N(z.over_capacity)}</span></span>}
                    <ExplainBtn e={z.explain} />
                  </div>
                </li>
              );
            })}
          </ul>
          <h3 className="mb-2 mt-5 text-sm font-bold">{T("leases")}</h3>
          {snap.leases.length === 0 ? <p className="text-xs text-muted">{T("leasesNone")}</p> : (
            <ul className="space-y-1.5">
              {snap.leases.map((l) => (
                <li key={l.id} className="rounded-lg bg-surface2 px-3 py-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2"><span className="font-semibold"><span className="num">{l.request_id}</span> · {l.company}</span><Pill tone={l.status}>{T(`lease.${l.status}`)}</Pill></div>
                  <div className="text-muted"><span className="num">{N(l.area)}</span> {T("fmt.m2")} · {l.zone_id} · <span className="num">{D(l.start_date)}</span> → <span className="num">{D(l.end_date)}</span> {l.status !== "ENDED" && <span>({T("returns")} {D(l.end_date)})</span>}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0 p-4 lg:col-span-3">
          <h3 className="mb-1 text-sm font-bold">{T("requests")}</h3>
          {afterNote && <p className="mb-3 text-xs text-muted">{afterNote}</p>}
          <ul className="space-y-2.5">
            {snap.requests.map((r) => {
              const rec = spaceRecs.get(r.request_id);
              const p = rec?.payload;
              const pend = rec?.status === "PENDING";
              const single = p && p.allocations?.length === 1 && p.decision !== "REJECT";
              return (
                <li key={r.request_id} className="rounded-xl border border-line bg-surface p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2"><span className="num text-xs font-bold text-muted">{r.request_id}</span><span className="font-semibold">{r.company}</span><Pill tone={r.required_storage_type === snap.sim.rentable_type ? "OK" : "Monitor"}>{T(`stype.${r.required_storage_type}`) === `stype.${r.required_storage_type}` ? r.required_storage_type : T(`stype.${r.required_storage_type}`)}</Pill></div>
                      <div className="mt-0.5 text-xs text-muted">{T("needs")} <span className="num font-semibold text-ink">{N(r.area_needed_m2)}</span> {T("fmt.m2")} · <span className="num">{N(r.duration_months)}</span> {T("months")} · {T("from")} <span className="num">{D(r.needed_from)}</span></div>
                    </div>
                    {p && (
                      <div className="text-end">
                        <Pill tone={p.decision}>{T(`dec.${p.decision}`)}</Pill>
                        {p.area_m2 > 0 && <div className="num mt-0.5 text-xs font-semibold">{N(p.area_m2)} {T("fmt.m2")} · {(p.allocations as { zone_id: string; area: number }[]).map((a) => a.zone_id).join(" + ")}</div>}
                      </div>
                    )}
                  </div>
                  {p && <p className="mt-1.5 text-sm text-muted">{R(p.reason)}</p>}
                  {p?.note && pend && <p className="mt-1 rounded-md bg-mon-soft px-2 py-1 text-xs text-mon">ⓘ {R(p.note)}</p>}
                  {rec && (
                    <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                      {pend && single && p.decision === "APPROVE" && (
                        <input aria-label={T("modifyArea")} title={T("modifyArea")} type="number" min={1} max={p.area_m2} placeholder={String(Math.round(p.area_m2))} value={area[rec.id] ?? ""} onChange={(e) => setArea((a) => ({ ...a, [rec.id]: e.target.value }))} className="num w-20 rounded-md border border-line bg-surface px-2 py-1 text-xs" />
                      )}
                      {pend && p.decision === "PARTIAL" && p.split && p.split.length > 0 && p.split.reduce((s: number, a: { area: number }) => s + a.area, 0) > p.area_m2 + 1e-6 && (
                        <Btn tone="ghost" disabled={busy} onClick={() => decide(rec.id, "APPROVED", { variant: "split" })}>{T("acceptSplit")}</Btn>
                      )}
                      {pend ? (
                        <>
                          <Btn tone="ok" disabled={busy} onClick={() => decide(rec.id, "APPROVED", area[rec.id] ? { area: Number(area[rec.id]) } : undefined)}>{T("approve")}</Btn>
                          <Btn tone="bad" disabled={busy} onClick={() => decide(rec.id, "REJECTED")}>{T("reject")}</Btn>
                        </>
                      ) : <ApprovalButtons rec={rec} />}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
