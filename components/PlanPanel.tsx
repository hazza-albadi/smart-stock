"use client";
import { useState } from "react";
import { useApp } from "./ctx";
import { ApprovalButtons, Btn, CardHead, CritBadge, ExplainBtn, Pill, QtyEdit } from "./ui";

const TONE: Record<string, string> = { FUNDED: "FUNDED", PARTIAL: "PARTIALF", DEFERRED: "DEFERRED", REJECTED: "REJECTEDLINE", OVERSTOCK: "OVERSTOCK" };

export default function PlanPanel() {
  const { snap, T, N, OMR, U, R, D, name, select, decide, busy } = useApp();
  const [showSkipped, setShowSkipped] = useState(false);
  const b = snap.budget;
  const remaining = b.total - b.committed - b.new_funded;
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / b.total) * 100))}%`;
  const recByItem = new Map(snap.recs.filter((r) => r.kind === "PO" && r.source === "agent" && r.status === "PENDING").map((r) => [r.item_id, r]));
  const lines = snap.plan.filter((p) => p.status !== "OVERSTOCK");
  const skipped = snap.plan.filter((p) => p.status === "OVERSTOCK");
  const pendingPos = [...recByItem.values()];

  return (
    <section id="plan" className="card scroll-mt-28" aria-label={T("planTitle")}>
      <CardHead title={T("planTitle")} sub={`${T("period")}: ${D(b.start)} → ${D(b.end)}`}
        right={pendingPos.length > 1 ? <Btn tone="ok" disabled={busy} onClick={async () => { for (const r of pendingPos) await decide(r.id, "APPROVED"); }}>{T("approveAll")} ({N(pendingPos.length)})</Btn> : undefined} />
      <div className="p-4">
        <div className="flex h-5 w-full overflow-hidden rounded-full bg-surface2 ring-1 ring-line" role="img" aria-label={`${T("committed")} ${OMR(b.committed)}, ${T("newDrafts")} ${OMR(b.new_funded)}, ${T("remaining")} ${OMR(remaining)}`}>
          <div className="transition-all duration-500" style={{ width: pct(b.committed), background: "var(--seg-used)" }} />
          <div className="transition-all duration-500" style={{ width: pct(b.new_funded), background: "var(--seg-rent)" }} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
          <Legend color="var(--seg-used)" label={T("committed")} v={OMR(b.committed)} />
          <Legend color="var(--seg-rent)" label={T("newDrafts")} v={OMR(b.new_funded)} />
          <Legend color="var(--line)" label={T("remaining")} v={OMR(remaining)} e={<ExplainBtn e={b.explain} />} />
          <span className="ms-auto text-muted">{T("budgetTotal")}: <span className="num font-bold text-ink">{OMR(b.total)}</span></span>
        </div>
        {b.over && <p className="mt-2 rounded-md bg-crit-soft px-2 py-1 text-xs font-semibold text-crit">⚠ {T("overBudget")}</p>}
      </div>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead className="bg-surface2 text-xs text-muted"><tr>{["rank", "item", "qty", "cost", "status", "reason"].map((k) => <th key={k} className="px-3 py-2 text-start font-semibold" scope="col">{T(k)}</th>)}<th className="px-3 py-2" /></tr></thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={7} className="p-5 text-center text-muted">{T("noPlan")}</td></tr>}
            {lines.map((p) => {
              const rec = recByItem.get(p.item_id);
              return (
                <tr key={p.id} className={`border-t border-line align-top ${p.status === "DEFERRED" ? "bg-high-soft/40" : ""}`}>
                  <td className="num px-3 py-2.5 font-bold">{N(p.rank)}</td>
                  <td className="px-3 py-2.5">
                    <button type="button" onClick={() => select(p.item_id)} className="text-start font-semibold leading-tight hover:text-brand hover:underline">{name(p.item_id)}</button>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted"><CritBadge c={p.criticality} rank={snap.items.find((i) => i.item_id === p.item_id)?.crit_rank ?? 9} /><span className="num">{p.item_id}</span><ExplainBtn e={p.explain} /></div>
                  </td>
                  <td className="px-3 py-2.5">{rec ? <QtyEdit rec={rec} /> : <span className="num font-semibold">{N(p.qty)}</span>} <span className="text-xs text-muted">{U(p.unit)}</span></td>
                  <td className="num px-3 py-2.5 font-semibold">{OMR(rec ? rec.payload.cost : p.cost)}</td>
                  <td className="px-3 py-2.5"><Pill tone={TONE[p.status]}>{T(`plan.${p.status}`)}</Pill></td>
                  <td className="max-w-[420px] px-3 py-2.5 text-xs text-muted">{R(p.reason)}</td>
                  <td className="px-3 py-2.5">{rec && <ApprovalButtons rec={rec} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {skipped.length > 0 && (
        <div className="border-t border-line p-3">
          <button type="button" className="text-sm font-semibold text-muted hover:text-brand" onClick={() => setShowSkipped((s) => !s)} aria-expanded={showSkipped}>{showSkipped ? "▾" : "▸"} {T("plan.OVERSTOCK")} <span className="num">({N(skipped.length)})</span></button>
          {showSkipped && <ul className="mt-2 grid gap-1.5 md:grid-cols-2">{skipped.map((p) => <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface2 px-3 py-1.5 text-xs"><span className="font-semibold">{name(p.item_id)}</span><span className="text-muted">{R(p.reason)}</span></li>)}</ul>}
        </div>
      )}
    </section>
  );
}

function Legend({ color, label, v, e }: { color: string; label: string; v: string; e?: React.ReactNode }) {
  return <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />{label}: <span className="num font-bold">{v}</span>{e}</span>;
}
