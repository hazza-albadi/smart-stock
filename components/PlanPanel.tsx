"use client";
import { useState } from "react";
import { useSnap } from "@/lib/store";
import { useApp, useBusy } from "./ctx";
import { Btn, Empty, ExplainBtn, Pill, To } from "./ui";

const TONE: Record<string, string> = { FUNDED: "FUNDED", PARTIAL: "PARTIALF", DEFERRED: "DEFERRED", REJECTED: "REJECTEDLINE", OVERSTOCK: "OVERSTOCK" };

export default function PlanPanel() {
  const { T, N, OMR, U, R, D, name, select, decide, confirm } = useApp();
  const busy = useBusy();
  const b = useSnap((s) => s.budget), plan = useSnap((s) => s.plan), recs = useSnap((s) => s.recs);
  const [showSkipped, setShowSkipped] = useState(false);
  const remaining = b.total + b.topup - b.committed - b.new_funded;
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / b.total) * 100))}%`;
  const drafts = recs.filter((r) => r.kind === "PO" && r.source === "agent" && r.status === "PENDING");
  const lines = plan.filter((p) => p.status !== "OVERSTOCK"), skipped = plan.filter((p) => p.status === "OVERSTOCK");
  return (
    <div className="flex h-[560px] flex-col">
      <div className="p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">{T("plan.period")}: <span className="num">{D(b.start)}</span><To /><span className="num">{D(b.end)}</span> · {T("plan.renews")} <span className="num font-semibold text-ink">{D(b.next_start)}</span> ({N(b.days_left)} {T("days")}, {OMR(b.next_amount)})</p>
          {drafts.length > 1 && <Btn tone="ok" disabled={busy} onClick={async () => { if (await confirm({ title: T("plan.approve_all"), body: T("plan.approve_all_body"), action: T("plan.approve_all") })) for (const r of drafts) await decide(r.id, "APPROVED"); }}>{T("plan.approve_all")} ({N(drafts.length)})</Btn>}
        </div>
        <div className="flex h-5 w-full overflow-hidden rounded-full bg-surface2 ring-1 ring-line" role="img" aria-label={`${T("plan.committed")} ${OMR(b.committed)}, ${T("plan.drafts")} ${OMR(b.new_funded)}, ${T("plan.left")} ${OMR(remaining)}`}>
          <div style={{ width: pct(b.committed), background: "var(--seg-used)" }} /><div style={{ width: pct(b.new_funded), background: "var(--seg-rent)" }} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <span><span className="me-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--seg-used)" }} aria-hidden />{T("plan.committed")}: <span className="num font-bold">{OMR(b.committed)}</span></span>
          <span><span className="me-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--seg-rent)" }} aria-hidden />{T("plan.drafts")}: <span className="num font-bold">{OMR(b.new_funded)}</span></span>
          <span>{T("plan.left")}: <span className="num font-bold">{OMR(remaining)}</span><ExplainBtn e={b.explain} /></span>
          <span className="ms-auto text-muted">{T("plan.total")}: <span className="num font-bold text-ink">{OMR(b.total)}</span></span>
        </div>
        {(b.topup > 0 || b.rollover > 0) && <p className="mt-1 text-sm text-muted">{b.rollover > 0 && <>{T("plan.rollover")}: <span className="num font-semibold text-ink">{OMR(b.rollover)}</span> · </>}{T("plan.emergency")}: <span className="num font-semibold text-high">{OMR(b.topup)}</span> / <span className="num">{OMR(b.emergency_limit)}</span></p>}
        {b.over && <p role="alert" className="mt-2 rounded-md bg-crit-soft px-2 py-1 text-sm font-semibold text-crit">⚠ {T("overBudget")}</p>}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead className="sticky top-0 bg-surface2 text-xs text-muted"><tr>{["plan.col_item", "plan.col_order", "plan.col_cost", "plan.col_status", "plan.col_why"].map((k) => <th key={k} className="px-3 py-2 text-start font-semibold" scope="col">{T(k)}</th>)}</tr></thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={5}><Empty title={T("plan.empty")} text={T("plan.empty_text")} /></td></tr>}
            {lines.map((p) => (
              <tr key={p.item_id} className={`border-t border-line align-top ${p.status === "DEFERRED" ? "bg-high-soft/40" : ""}`}>
                <td className="px-3 py-2.5"><button type="button" onClick={() => select(p.item_id)} className="min-h-9 text-start font-semibold leading-tight hover:text-brand hover:underline">{name(p.item_id)}</button></td>
                <td className="px-3 py-2.5"><span className="num font-semibold">{N(p.qty)}</span> <span className="text-xs text-muted">{U(p.unit)}</span></td>
                <td className="num px-3 py-2.5 font-semibold">{OMR(p.cost)}</td>
                <td className="px-3 py-2.5"><Pill tone={TONE[p.status]}>{T(`plan.${p.status}`)}</Pill></td>
                <td className="max-w-[360px] px-3 py-2.5 text-xs text-muted">{R(p.reason)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {skipped.length > 0 && (
          <div className="border-t border-line p-3">
            <button type="button" className="min-h-10 text-sm font-semibold text-muted hover:text-brand" onClick={() => setShowSkipped((s) => !s)} aria-expanded={showSkipped}>{showSkipped ? "▾" : "▸"} {T("plan.too_much")} ({N(skipped.length)})</button>
            {showSkipped && <ul className="mt-2 space-y-1.5">{skipped.map((p) => <li key={p.item_id} className="rounded-lg bg-surface2 px-3 py-2 text-sm"><span className="font-semibold">{name(p.item_id)}</span> <span className="text-muted">— {R(p.reason)}</span></li>)}</ul>}
          </div>
        )}
      </div>
    </div>
  );
}
