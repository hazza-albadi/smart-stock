"use client";
import { tr, type Lang, type Key } from "@/lib/i18n";
import type { Snapshot } from "@/lib/snapshot";
import { Btn, CardHead, Spinner, pick } from "./ui";

const KIND: Record<string, Key> = { forecast: "kindRead", replenishment: "kindReason", space: "kindReason", alerts: "kindAct", matching: "kindAct" };

export interface Analysis { running: boolean; step: number }

function groupLabel(lang: Lang, g: string) {
  if (g.endsWith("#tick")) return tr(lang, "runAuto");
  if (g.endsWith("#decision")) return tr(lang, "runDecision");
  if (g === "start") return tr(lang, "runStart");
  return tr(lang, "runManual");
}

export default function AgentPanel({ lang, snap, analysis, onAnalyse }: { lang: Lang; snap: Snapshot; analysis: Analysis; onAnalyse: () => void }) {
  const order = snap.agent_order as readonly string[];
  const groups: { group: string; rows: Snapshot["runs"] }[] = [];
  for (const r of snap.runs) {
    let g = groups.find((x) => x.group === r.run_group);
    if (!g) { g = { group: r.run_group, rows: [] }; groups.push(g); }
    g.rows.push(r);
  }
  const visible = groups.slice(0, 4);

  return (
    <section id="agents" className="card scroll-mt-20" aria-label={tr(lang, "agentsTitle")}>
      <CardHead title={tr(lang, "agentsTitle")}
        sub={snap.llm ? tr(lang, "llmOn") : tr(lang, "llmOff")}
        right={<Btn tone="primary" onClick={onAnalyse} disabled={analysis.running}>{analysis.running ? <Spinner /> : "✦"} {tr(lang, analysis.running ? "analysing" : "runAnalysis")}</Btn>} />
      <div className="px-4 pt-4">
        <ol className="flex flex-wrap items-center gap-1.5" aria-label="pipeline">
          {order.map((a, i) => {
            const state = !analysis.running ? "idle" : i < analysis.step ? "done" : i === analysis.step ? "run" : "wait";
            return (
              <li key={a} className="flex items-center gap-1.5">
                <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition
                  ${state === "run" ? "border-brand bg-brand text-brand-ink" : state === "done" ? "border-ok bg-ok-soft text-ok" : "border-line bg-surface2 text-muted"}`}>
                  {state === "run" ? <Spinner /> : <span className="num">{state === "done" ? "✓" : i + 1}</span>}
                  {tr(lang, a as Key)}
                </span>
                {i < order.length - 1 && <span className="text-muted rtl:rotate-180" aria-hidden>→</span>}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="scroll-thin max-h-[520px] space-y-4 overflow-y-auto p-4">
        {visible.map((g, gi) => {
          const sorted = [...g.rows].sort((a, b) => order.indexOf(a.agent) - order.indexOf(b.agent));
          return (
            <div key={g.group}>
              <div className="mb-1.5 flex items-center gap-2 text-xs text-muted">
                <span className="num font-semibold text-ink">{g.rows[0].sim_date}</span>
                <span className="rounded bg-surface2 px-1.5 py-0.5 font-semibold">{groupLabel(lang, g.group)}</span>
                {gi === 0 && <span className="rounded bg-brand-soft px-1.5 py-0.5 font-semibold text-brand">{lang === "ar" ? "الأحدث" : "latest"}</span>}
              </div>
              <ol className="relative space-y-2 border-s-2 border-line ps-4">
                {sorted.map((r) => (
                  <li key={r.id} className="relative">
                    <span className="absolute -start-[22px] top-1.5 h-3 w-3 rounded-full border-2 border-brand bg-surface" aria-hidden />
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      {tr(lang, r.agent as Key)}
                      <span className="rounded bg-surface2 px-1.5 text-[10px] font-bold text-muted">{tr(lang, KIND[r.agent])}</span>
                    </div>
                    <p className="text-xs leading-relaxed text-muted">{pick(lang, r.summary_en, r.summary_ar)}</p>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </section>
  );
}
