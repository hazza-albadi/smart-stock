"use client";
import { useState } from "react";
import { tr, nf, unitName, type Lang } from "@/lib/i18n";
import type { Snapshot } from "@/lib/snapshot";
import { ApprovalButtons, Btn, CardHead, CritBadge, Pill, pick } from "./ui";

const STATUS_TONE: Record<string, string> = { FUNDED: "FUNDED", PARTIAL: "PARTIALF", DEFERRED: "DEFERRED", REJECTED: "REJECTEDLINE", OVERSTOCK: "OVERSTOCK" };
const STATUS_KEY = { FUNDED: "funded", PARTIAL: "partial", DEFERRED: "deferred", REJECTED: "rejectedLine", OVERSTOCK: "overstockSkip" } as const;

export default function PlanPanel({ lang, snap, busy, onDecide, onSelect }: {
  lang: Lang; snap: Snapshot; busy: boolean; onDecide: (id: number, d: "APPROVED" | "REJECTED") => void; onSelect: (id: string) => void;
}) {
  const [showSkipped, setShowSkipped] = useState(false);
  const b = snap.budget;
  const remaining = b.total - b.committed - b.new_funded;
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / b.total) * 100))}%`;
  const recByItem = new Map(snap.recs.filter((r) => r.kind === "PO").map((r) => [r.item_id, r]));
  const lines = snap.plan.filter((p) => p.status !== "OVERSTOCK");
  const skipped = snap.plan.filter((p) => p.status === "OVERSTOCK");
  const pendingPos = snap.recs.filter((r) => r.kind === "PO" && r.status === "PENDING");

  return (
    <section id="plan" className="card scroll-mt-20" aria-label={tr(lang, "planTitle")}>
      <CardHead title={tr(lang, "planTitle")}
        sub={`${tr(lang, "period")}: ${b.start} → ${b.end}`}
        right={pendingPos.length > 1 ? (
          <Btn tone="ok" disabled={busy} onClick={async () => { for (const r of pendingPos) await onDecide(r.id, "APPROVED"); }}>{tr(lang, "approveAll")} ({pendingPos.length})</Btn>
        ) : undefined} />
      <div className="p-4">
        <div className="flex h-5 w-full overflow-hidden rounded-full bg-surface2 ring-1 ring-line" role="img"
          aria-label={`${tr(lang, "committed")} ${nf(b.committed)}, ${tr(lang, "newDrafts")} ${nf(b.new_funded)}, ${tr(lang, "remaining")} ${nf(remaining)}`}>
          <div className="bg-seg-used transition-all duration-500" style={{ width: pct(b.committed), background: "var(--seg-used)" }} />
          <div className="transition-all duration-500" style={{ width: pct(b.new_funded), background: "var(--seg-rent)" }} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
          <Legend color="var(--seg-used)" label={tr(lang, "committed")} v={b.committed} />
          <Legend color="var(--seg-rent)" label={tr(lang, "newDrafts")} v={b.new_funded} />
          <Legend color="var(--line)" label={tr(lang, "remaining")} v={remaining} />
          <span className="ms-auto text-muted">{tr(lang, "budgetTotal")}: <span className="num font-bold text-ink">{nf(b.total)}</span> {lang === "ar" ? "ر.ع" : "OMR"}</span>
        </div>
      </div>

      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead className="bg-surface2 text-xs text-muted">
            <tr>{(["rank", "item", "qty", "cost", "status", "reason"] as const).map((k) => <th key={k} className="px-3 py-2 text-start font-semibold" scope="col">{tr(lang, k)}</th>)}<th className="px-3 py-2" /></tr>
          </thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={7} className="p-5 text-center text-muted">{tr(lang, "noPlan")}</td></tr>}
            {lines.map((p) => {
              const rec = recByItem.get(p.item_id);
              return (
                <tr key={p.id} className={`border-t border-line align-top ${p.status === "DEFERRED" ? "bg-high-soft/40" : ""}`}>
                  <td className="num px-3 py-2.5 font-bold">{p.rank}</td>
                  <td className="px-3 py-2.5">
                    <button type="button" onClick={() => onSelect(p.item_id)} className="text-start font-semibold leading-tight hover:text-brand hover:underline">{pick(lang, p.name_en, p.name_ar)}</button>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted"><CritBadge c={p.criticality} /><span className="num">{p.item_id}</span></div>
                  </td>
                  <td className="px-3 py-2.5"><span className="num font-semibold">{nf(p.qty)}</span> <span className="text-xs text-muted">{unitName(lang, p.unit)}</span></td>
                  <td className="num px-3 py-2.5 font-semibold">{nf(p.cost)}</td>
                  <td className="px-3 py-2.5"><Pill tone={STATUS_TONE[p.status]}>{tr(lang, STATUS_KEY[p.status as keyof typeof STATUS_KEY])}</Pill></td>
                  <td className="max-w-[420px] px-3 py-2.5 text-xs text-muted">{pick(lang, p.reason_en, p.reason_ar)}</td>
                  <td className="px-3 py-2.5">
                    {rec && (p.status === "FUNDED" || p.status === "PARTIAL") && <ApprovalButtons lang={lang} status={rec.status} busy={busy} onDecide={(d) => onDecide(rec.id, d)} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {skipped.length > 0 && (
        <div className="border-t border-line p-3">
          <button type="button" className="text-sm font-semibold text-muted hover:text-brand" onClick={() => setShowSkipped((s) => !s)} aria-expanded={showSkipped}>
            {showSkipped ? "▾" : "▸"} {tr(lang, "overstockSkip")} <span className="num">({skipped.length})</span>
          </button>
          {showSkipped && (
            <ul className="mt-2 grid gap-1.5 md:grid-cols-2">
              {skipped.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface2 px-3 py-1.5 text-xs">
                  <span className="font-semibold">{pick(lang, p.name_en, p.name_ar)}</span>
                  <span className="text-muted">{pick(lang, p.reason_en, p.reason_ar)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function Legend({ color, label, v }: { color: string; label: string; v: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />{label}: <span className="num font-bold">{nf(v)}</span>
    </span>
  );
}
