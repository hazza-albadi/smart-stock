"use client";
import { REGISTRY, type AgentDef } from "@/lib/agents/registry";
import { STAGES } from "@/lib/agents/stage-names";
import { useSnap } from "@/lib/store";
import { useApp } from "./ctx";
import { Pill } from "./ui";

const Chip = ({ children }: { children: string }) => <code className="rounded bg-surface2 px-1.5 py-0.5 text-[11px]">{children}</code>;

/** Help tab: the flow, one card per registered agent (role, reads, writes, schedule, last run, self-check) and where the human approves. */
export default function HowAgentsWork() {
  const { T, N, R, CK, DT } = useApp();
  const status = useSnap((s) => s.agents);
  const hoursText = (a: AgentDef, hours: number[]) => `${hours.length >= 24 ? T("agents.card.every_hour") : `${T("agents.card.at_hours")} ${hours.map((h) => CK(h)).join(", ")}`}${a.afterDecision ? ` ${T("agents.card.after_decision")}` : ""}`;
  return (
    <div className="space-y-4 text-sm">
      <section aria-label={T("agents.flow.title")}>
        <h3 className="font-bold">{T("agents.flow.title")}</h3>
        <p className="mt-1 leading-relaxed text-muted">{T("agents.flow.text")}</p>
        <ol className="mt-3 flex flex-wrap items-center gap-1.5">
          {REGISTRY.map((a, i) => (
            <li key={a.id} className="flex items-center gap-1.5">
              <span className="flex min-h-9 items-center gap-1.5 rounded-full border border-brand bg-brand-soft px-3 text-xs font-bold"><span className="num">{N(i + 1)}</span>{T(`agent.${a.id}`)}</span>
              <span className="text-muted rtl:rotate-180" aria-hidden>→</span>
            </li>
          ))}
          <li><span className="flex min-h-9 items-center rounded-full border border-ok bg-ok-soft px-3 text-xs font-bold text-ok">{T("agents.flow.human")}</span></li>
        </ol>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-dashed border-line px-3 py-2 text-xs"><b>{T("agents.flow.coordinator")}</b> · <b>{T("agents.flow.db")}</b> (SQLite)</div>
          <div className="rounded-lg border border-line px-3 py-2 text-xs font-semibold">{STAGES.map((s) => T(`stage.${s}`)).join(" → ")}</div>
        </div>
      </section>
      <ul className="grid gap-3 md:grid-cols-2">
        {REGISTRY.map((a, i) => {
          const st = status.find((x) => x.id === a.id);
          const v = st?.verify ?? null;
          return (
            <li key={a.id} className="flex min-h-[21rem] flex-col rounded-xl border border-line bg-surface p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-ink"><span className="num">{N(i + 1)}</span></span>
                <h4 className="font-bold">{T(`agent.${a.id}`)}</h4>
                <Pill tone="Info" icon={false}>{T(`stage.${a.stage}`)}</Pill>
              </div>
              <p className="mt-1.5 leading-relaxed">{T(`agentdef.${a.id}.role`)}</p>
              <dl className="mt-2 space-y-1.5 text-xs">
                <div><dt className="font-semibold text-muted">{T("agents.card.reads")}</dt><dd className="mt-0.5 flex flex-wrap gap-1" dir="ltr">{a.reads.map((t) => <Chip key={t}>{t}</Chip>)}</dd></div>
                <div><dt className="font-semibold text-muted">{T("agents.card.writes")}</dt><dd className="mt-0.5 flex flex-wrap gap-1" dir="ltr">{a.writes.map((t) => <Chip key={t}>{t}</Chip>)}</dd></div>
                <div><dt className="font-semibold text-muted">{T("agents.card.runs")}</dt><dd>{st ? hoursText(a, st.hours) : "—"}</dd></div>
                <div><dt className="font-semibold text-muted">{T("agents.card.hands")}</dt><dd>{a.handsOver ? T(`agent.${a.handsOver}`) : T("agents.card.human")}</dd></div>
              </dl>
              <div className="mt-auto border-t border-line pt-2 text-xs">
                <div className="font-semibold text-muted">{T("agents.card.last")}</div>
                <p className="leading-relaxed">{st?.last_run ? <><span className="num font-semibold">{DT(st.last_run.tick)}</span> · {R(st.last_run.summary)}</> : T("agents.card.never")}</p>
                <div className="mt-1.5 flex items-start gap-1.5">
                  <span role="img" aria-label={T(v?.ok === false ? "agents.check_failed" : "agents.check_ok")} className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-bold ${v ? (v.ok ? "bg-ok-soft text-ok" : "bg-crit-soft text-crit") : "bg-surface2 text-muted"}`}>{v ? (v.ok ? "✓" : "✕") : "–"}</span>
                  <span className="leading-relaxed"><b>{T("agents.card.verify")}:</b> {v ? R(v.msg) : T("agents.card.never")}</span>
                </div>
                <ul className="mt-1 list-disc ps-5 text-muted">{a.verifies.map((c) => <li key={c}>{T(`vchk.${c}`)}</li>)}</ul>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="rounded-lg border border-ok bg-ok-soft px-3 py-2 leading-relaxed text-ok">{T("agents.flow.human_text")}</p>
    </div>
  );
}
