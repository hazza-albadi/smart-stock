"use client";
import { useMemo, useState } from "react";
import { useSnap } from "@/lib/store";
import { useApp } from "./ctx";
import { Btn, Empty, Spinner } from "./ui";

export interface Analysis { running: boolean; step: number }

/** What the five automatic helpers checked, in plain sentences. */
export default function AgentPanel({ analysis, onAnalyse }: { analysis: Analysis; onAnalyse: () => void }) {
  const { T, N, R, DT } = useApp();
  const runs = useSnap((s) => s.runs);
  const order = useSnap((s) => s.agent_order) as readonly string[];
  const [shown, setShown] = useState(4);
  const groups = useMemo(() => {
    const out: { group: string; rows: typeof runs }[] = [];
    for (const r of runs) { let g = out.find((x) => x.group === r.run_group); if (!g) { g = { group: r.run_group, rows: [] }; out.push(g); } g.rows.push(r); }
    return out;
  }, [runs]);
  const label = (tr: string) => (tr === "start" ? T("run.start") : ["decision", "request"].includes(tr) ? T("run.decision") : /^h\d\d$/.test(tr) ? `${T("run.scheduled")} ${tr.slice(1)}:00` : T("run.manual"));
  return (
    <div className="flex h-[560px] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <p className="min-w-0 flex-1 text-sm text-muted">{T("agents.sub")}</p>
        <Btn tone="primary" onClick={onAnalyse} disabled={analysis.running} title={T("agents.run_hint")}>{analysis.running ? <Spinner /> : "✦"} {T(analysis.running ? "agents.running" : "agents.run")}</Btn>
      </div>
      <ol className="flex flex-wrap items-center gap-1.5 px-4 pt-3" aria-label={T("agents.title")}>
        {order.map((a, i) => {
          const state = !analysis.running ? "idle" : i < analysis.step ? "done" : i === analysis.step ? "run" : "wait";
          return (
            <li key={a} className="flex items-center gap-1.5">
              <span className={`flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold ${state === "run" ? "border-brand bg-brand text-brand-ink" : state === "done" ? "border-ok bg-ok-soft text-ok" : "border-line bg-surface2 text-muted"}`}>
                {state === "run" ? <Spinner /> : <span className="num">{state === "done" ? "✓" : N(i + 1)}</span>}{T(`agent.${a}`)}
              </span>
              {i < order.length - 1 && <span className="text-muted rtl:rotate-180" aria-hidden>→</span>}
            </li>
          );
        })}
      </ol>
      <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {groups.length === 0 && <Empty icon="⚙" title={T("agents.empty")} />}
        {groups.slice(0, shown).map((g) => (
          <div key={g.group}>
            <div className="mb-1 flex items-center gap-2 text-xs text-muted"><span className="num font-semibold text-ink">{DT(g.rows[0].tick)}</span><span className="rounded bg-surface2 px-1.5 py-0.5 font-semibold">{label(g.rows[0].trigger)}</span></div>
            <ol className="space-y-2 border-s-2 border-line ps-4">
              {[...g.rows].sort((a, b) => order.indexOf(a.agent) - order.indexOf(b.agent)).map((r) => (
                <li key={r.id}><div className="text-sm font-semibold">{T(`agent.${r.agent}`)}</div><p className="text-sm leading-relaxed text-muted">{R(r.summary)}</p></li>
              ))}
            </ol>
          </div>
        ))}
        {groups.length > shown && <button type="button" onClick={() => setShown((s) => s + 6)} className="min-h-11 w-full rounded-lg border border-line text-sm font-semibold text-brand hover:bg-surface2">{T("loadMore")}</button>}
      </div>
    </div>
  );
}
