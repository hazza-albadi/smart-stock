"use client";
import type { ChangeSummary as Change } from "@/lib/changes";
import { useApp } from "./ctx";

/** "What changed after your decision": which agents ran again and the numbers that moved. Sits in the toast stack, never blocks the screen. */
export default function ChangeSummary({ change, onClose, onAgents }: { change: Change; onClose: () => void; onAgents: () => void }) {
  const { T, R } = useApp();
  return (
    <div role="status" className="pointer-events-auto rounded-xl border border-s-4 border-brand bg-surface px-3 py-2.5 text-sm shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <strong className="text-sm">{T("chg.title")}</strong>
        <button type="button" onClick={onClose} aria-label={T("dismiss")} className="-me-1 -mt-1 min-h-10 min-w-10 text-muted hover:text-ink">✕</button>
      </div>
      {change.agents.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted">{T("chg.agents")}</span>
          {change.agents.map((a) => <span key={a} className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">✓ {T(`agent.${a}`)}</span>)}
        </div>
      )}
      <ul className="mt-1.5 list-disc space-y-0.5 ps-5">{change.lines.map((l, i) => <li key={i}>{R(l)}</li>)}</ul>
      {change.agents.length > 0 && <button type="button" onClick={onAgents} className="mt-1 min-h-10 text-xs font-semibold text-brand hover:underline">{T("chg.more")}</button>}
    </div>
  );
}
