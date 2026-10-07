"use client";
import { useState } from "react";
import { useApp } from "./ctx";
import { Btn, CardHead, Spinner } from "./ui";

const KIND: Record<string, string> = { forecast: "kindRead", replenishment: "kindReason", space: "kindReason", alerts: "kindAct", matching: "kindAct" };
export interface Analysis { running: boolean; step: number }

export default function AgentPanel({ analysis, onAnalyse }: { analysis: Analysis; onAnalyse: () => void }) {
  const { snap, T, N, R, DT } = useApp();
  const [shown, setShown] = useState(4);
  const order = snap.agent_order as readonly string[];
  const groups: { group: string; rows: typeof snap.runs }[] = [];
  for (const r of snap.runs) {
    let g = groups.find((x) => x.group === r.run_group);
    if (!g) { g = { group: r.run_group, rows: [] }; groups.push(g); }
    g.rows.push(r);
  }
  const label = (tr: string) => (tr === "start" ? T("run.start") : tr === "manual" ? T("run.manual") : ["decision", "request"].includes(tr) ? T("run.decision") : /^h\d\d$/.test(tr) ? `${T("run.scheduled")} ${tr.slice(1)}:00` : T("run.manual"));
  return (
    <section id="agents" className="card scroll-mt-28" aria-label={T("agentsTitle")}>
      <CardHead title={T("agentsTitle")} sub={`${T("agents.schedule")}: ${T("agents.scheduleText")}`}
        right={<Btn tone="primary" onClick={onAnalyse} disabled={analysis.running}>{analysis.running ? <Spinner /> : "✦"} {T(analysis.running ? "analysing" : "runAnalysis")}</Btn>} />
      <div className="px-4 pt-4">
        <ol className="flex flex-wrap items-center gap-1.5" aria-label="pipeline">
          {order.map((a, i) => {
            const state = !analysis.running ? "idle" : i < analysis.step ? "done" : i === analysis.step ? "run" : "wait";
            return (
              <li key={a} className="flex items-center gap-1.5">
                <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${state === "run" ? "border-brand bg-brand text-brand-ink" : state === "done" ? "border-ok bg-ok-soft text-ok" : "border-line bg-surface2 text-muted"}`}>
                  {state === "run" ? <Spinner /> : <span className="num">{state === "done" ? "✓" : N(i + 1)}</span>}{T(`agent.${a}`)}
                </span>
                {i < order.length - 1 && <span className="text-muted rtl:rotate-180" aria-hidden>→</span>}
              </li>
            );
          })}
        </ol>
      </div>
      <div className="scroll-thin max-h-[560px] space-y-4 overflow-y-auto p-4">
        {groups.slice(0, shown).map((g, gi) => {
          const sorted = [...g.rows].sort((a, b) => order.indexOf(a.agent) - order.indexOf(b.agent));
          return (
            <div key={g.group}>
              <div className="mb-1.5 flex items-center gap-2 text-xs text-muted">
                <span className="num font-semibold text-ink">{DT(g.rows[0].tick)}</span>
                <span className="rounded bg-surface2 px-1.5 py-0.5 font-semibold">{label(g.rows[0].trigger)}</span>
                {gi === 0 && <span className="rounded bg-brand-soft px-1.5 py-0.5 font-semibold text-brand">{T("latest")}</span>}
              </div>
              <ol className="relative space-y-2 border-s-2 border-line ps-4">
                {sorted.map((r) => (
                  <li key={r.id} className="relative">
                    <span className="absolute -start-[22px] top-1.5 h-3 w-3 rounded-full border-2 border-brand bg-surface" aria-hidden />
                    <div className="flex items-center gap-2 text-sm font-semibold">{T(`agent.${r.agent}`)}<span className="rounded bg-surface2 px-1.5 text-[10px] font-bold text-muted">{T(KIND[r.agent])}</span></div>
                    <p className="text-xs leading-relaxed text-muted">{R(r.summary)}</p>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
        {groups.length > shown && <button type="button" onClick={() => setShown((s) => s + 6)} className="w-full rounded-lg border border-line p-2 text-sm font-semibold text-brand hover:bg-surface2">{T("loadMore")}</button>}
      </div>
    </section>
  );
}
