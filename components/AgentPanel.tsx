"use client";
import { useMemo, useState } from "react";
import { useSnap } from "@/lib/store";
import { STAGES } from "@/lib/agents/stage-names";
import { useApp } from "./ctx";
import { Btn, Empty, Spinner } from "./ui";

export interface Analysis { running: boolean; step: number }

/** Pass / fail mark of one stage. Always the same width, so rows never jump. */
const Mark = ({ ok, label }: { ok: boolean; label: string }) => (
  <span role="img" aria-label={label} title={label} className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${ok ? "bg-ok-soft text-ok" : "bg-crit-soft text-crit"}`}>{ok ? "✓" : "✕"}</span>
);

/** What the five automatic agents did, run by run: for every agent its four stages (read, reason, act, verify) in order, with a mark for its own check. */
export default function AgentPanel({ analysis, onAnalyse }: { analysis: Analysis; onAnalyse: () => void }) {
  const { T, N, R, DT } = useApp();
  const runs = useSnap((s) => s.runs);
  const steps = useSnap((s) => s.steps);
  const agents = useSnap((s) => s.agents);
  const order = useSnap((s) => s.agent_order) as readonly string[];
  const [shown, setShown] = useState(4);
  const groups = useMemo(() => {
    const out: { group: string; rows: typeof runs }[] = [];
    for (const r of runs) { let g = out.find((x) => x.group === r.run_group); if (!g) { g = { group: r.run_group, rows: [] }; out.push(g); } g.rows.push(r); }
    return out;
  }, [runs]);
  const warned: string[] = agents.filter((a) => a.verify && !a.verify.ok).map((a) => a.id);
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
          const bad = warned.includes(a);
          return (
            <li key={a} className="flex items-center gap-1.5">
              <span className={`flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold ${bad ? "border-crit bg-crit-soft text-crit" : state === "run" ? "border-brand bg-brand text-brand-ink" : state === "done" ? "border-ok bg-ok-soft text-ok" : "border-line bg-surface2 text-muted"}`}>
                {state === "run" ? <Spinner /> : <span className="num">{bad ? "✕" : state === "done" ? "✓" : N(i + 1)}</span>}{T(`agent.${a}`)}
              </span>
              {i < order.length - 1 && <span className="text-muted rtl:rotate-180" aria-hidden>→</span>}
            </li>
          );
        })}
      </ol>
      {warned.length > 0 && <p role="alert" className="mx-4 mt-2 rounded-lg border border-crit bg-crit-soft px-3 py-1.5 text-xs font-semibold text-crit">{T("agents.warning")}</p>}
      <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {groups.length === 0 && <Empty icon="⚙" title={T("agents.empty")} />}
        {groups.slice(0, shown).map((g) => (
          <div key={g.group}>
            <div className="mb-1 flex items-center gap-2 text-xs text-muted"><span className="num font-semibold text-ink">{DT(g.rows[0].tick)}</span><span className="rounded bg-surface2 px-1.5 py-0.5 font-semibold">{label(g.rows[0].trigger)}</span></div>
            <ol className="space-y-3 border-s-2 border-line ps-4">
              {[...order].map((agent) => {
                const mine = steps.filter((x) => x.run_group === g.group && x.agent === agent);
                const run = [...g.rows].reverse().find((r) => r.agent === agent);
                if (!mine.length && !run) return null;
                const attempts = [...new Set(mine.map((x) => x.attempt))].sort((a, b) => a - b);
                return (
                  <li key={agent}>
                    <div className="text-sm font-semibold">{T(`agent.${agent}`)}</div>
                    {attempts.length === 0 && run && <p className="text-sm leading-relaxed text-muted">{R(run.summary)}</p>}
                    {attempts.map((at) => (
                      <div key={at} className={attempts.length > 1 ? "mt-1 rounded-lg border border-line bg-surface2 p-2" : ""}>
                        {attempts.length > 1 && <div className="mb-1 text-xs font-semibold text-muted">{T("agents.attempt")} <span className="num">{N(at)}</span>{at > 1 && <> · {T("agents.rerun")}</>}</div>}
                        <ol className="space-y-1">
                          {STAGES.map((st) => {
                            const row = mine.find((x) => x.attempt === at && x.stage === st);
                            if (!row) return null;
                            return (
                              <li key={st} className="grid grid-cols-[1.25rem_4.5rem_1fr] items-start gap-x-2 text-sm">
                                <Mark ok={!!row.ok} label={T(row.ok ? "agents.check_ok" : "agents.check_failed")} />
                                <span className="pt-px text-xs font-bold uppercase text-muted">{T(`stage.${st}`)}</span>
                                <span className={`min-w-0 leading-relaxed ${row.ok ? "" : "font-semibold text-crit"}`}>{R(row.summary)}</span>
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    ))}
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
        {groups.length > shown && <button type="button" onClick={() => setShown((s) => s + 6)} className="min-h-11 w-full rounded-lg border border-line text-sm font-semibold text-brand hover:bg-surface2">{T("loadMore")}</button>}
      </div>
    </div>
  );
}
