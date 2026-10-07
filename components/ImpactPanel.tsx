"use client";
import { useEffect, useState } from "react";
import { useSnap } from "@/lib/store";
import { useApp } from "./ctx";
import { Empty, Pill, Skeleton } from "./ui";
import type { ImpactRow } from "@/lib/impact";

/** What happened after each of your decisions, read from the event chain in the database. */
export default function ImpactPanel({ version }: { version: string }) {
  const { T, R, DT } = useApp();
  const pageSize = useSnap((s) => s.sim.page_size);
  const [rows, setRows] = useState<ImpactRow[] | null>(null);
  const [limit, setLimit] = useState(pageSize);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let off = false;
    fetch(`/api/impact?limit=${limit}`).then((r) => r.json()).then((j) => { if (!off && Array.isArray(j)) { setRows(j); setErr(false); } }).catch(() => !off && setErr(true));
    return () => { off = true; };
  }, [version, limit]);
  return (
    <div className="flex h-[560px] flex-col">
      <p className="border-b border-line px-4 py-3 text-sm text-muted">{T("impact.sub")}</p>
      <ul className="scroll-thin min-h-0 flex-1 divide-y divide-line overflow-y-auto">
        {err && <li className="p-4 text-sm text-crit">{T("err.load")}</li>}
        {rows === null && !err && <li className="space-y-3 p-4"><Skeleton h={18} w="60%" /><Skeleton h={14} /><Skeleton h={14} w="80%" /></li>}
        {rows && rows.length === 0 && <li className="h-full"><Empty icon="☰" title={T("impact.none")} text={T("impact.none_text")} /></li>}
        {rows?.map((r) => (
          <li key={r.id} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone={r.decision === "REJECTED" ? "REJECTED" : r.decision === "APPROVED" ? "APPROVED" : "user"}>{T(`impact.dec.${r.decision}`) === `impact.dec.${r.decision}` ? T("impact.dec.other") : T(`impact.dec.${r.decision}`)}</Pill>
              <span className="num text-xs text-muted">{DT(r.tick)}</span>
              {r.state === "none" && <Pill tone="ENDED" icon={false}>{T("impact.noeffect")}</Pill>}
            </div>
            <p className="mt-1 font-semibold">{R(r.head)}</p>
            <ul className="mt-1 space-y-0.5 border-s-2 border-line ps-3 text-muted">{r.effects.map((e, i) => <li key={i}>{R(e)}</li>)}</ul>
          </li>
        ))}
        {rows && rows.length >= limit && <li><button type="button" onClick={() => setLimit((l) => l + pageSize)} className="min-h-11 w-full text-sm font-semibold text-brand hover:bg-surface2">{T("loadMore")}</button></li>}
      </ul>
    </div>
  );
}
