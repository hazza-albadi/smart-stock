"use client";
import { useEffect, useState } from "react";
import { useApp } from "./ctx";
import { CardHead, Pill } from "./ui";
import type { ImpactRow } from "@/lib/impact";

/** Decision impact log: every decision with its causes and effects, read from the event chain in the database. */
export default function ImpactPanel({ version }: { version: string }) {
  const { T, R, DT, snap } = useApp();
  const [rows, setRows] = useState<ImpactRow[]>([]);
  const [limit, setLimit] = useState(snap.sim.page_size);
  useEffect(() => {
    let off = false;
    fetch(`/api/impact?limit=${limit}`).then((r) => r.json()).then((j) => !off && Array.isArray(j) && setRows(j)).catch(() => {});
    return () => { off = true; };
  }, [version, limit]);
  return (
    <section id="impact" className="card scroll-mt-28" aria-label={T("impactTitle")}>
      <CardHead title={T("impactTitle")} sub={T("impactSub")} />
      <ul className="scroll-thin max-h-[520px] divide-y divide-line overflow-y-auto">
        {rows.length === 0 && <li className="p-5 text-center text-sm text-muted">{T("impactNone")}</li>}
        {rows.map((r) => (
          <li key={r.id} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={r.decision === "REJECTED" ? "REJECTED" : r.decision === "APPROVED" ? "APPROVED" : "user"}>{T(`impact.dec.${r.decision}`) === `impact.dec.${r.decision}` ? r.decision : T(`impact.dec.${r.decision}`)}</Pill>
              <span className="num text-[11px] text-muted">{DT(r.tick)}</span>
              {r.state === "none" && <Pill tone="ENDED">{T("impact.noeffect")}</Pill>}
            </div>
            <p className="mt-1 font-semibold">{R(r.head)}</p>
            <ul className="mt-1 space-y-0.5 border-s-2 border-line ps-3 text-muted">{r.effects.map((e, i) => <li key={i}>{R(e)}</li>)}</ul>
          </li>
        ))}
      </ul>
      {rows.length >= limit && <button type="button" onClick={() => setLimit((l) => l + snap.sim.page_size)} className="w-full border-t border-line p-3 text-sm font-semibold text-brand hover:bg-surface2">{T("loadMore")}</button>}
    </section>
  );
}
