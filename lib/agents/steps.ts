// Stage log (READ -> REASON -> ACT -> VERIFY) and the VERIFY helpers shared by the five agents and the coordinator.
// Steps are plain rows in `agent_steps`; the one-line run summary in `agent_runs` keeps working as before.
import { db } from "../db";
import { getSim, M, type Msg } from "../core";
import type { VCheck } from "../checks";
import type { AgentId } from "./registry";

export { STAGES, type Stage } from "./stage-names";
import type { Stage } from "./stage-names";

/** What an agent says about itself after a run: what it read (counts), decided, and wrote. */
export interface StageMsgs { read: Msg; reason: Msg; act: Msg }
export interface Verdict { ok: boolean; checks: VCheck[] }

export const verdictOf = (checks: VCheck[]): Verdict => ({ ok: checks.every((c) => c.ok), checks });

/** Test seam: make the next `times` VERIFY stages of an agent fail (proves the re-run and the visible warning). Never set in the app. */
const forced = new Map<AgentId, number>();
export const forceVerifyFailure = (id: AgentId, times = 1) => { forced.set(id, times); };
export function applyForced(id: AgentId, checks: VCheck[]): VCheck[] {
  const n = forced.get(id) ?? 0;
  if (n <= 0) return checks;
  forced.set(id, n - 1);
  return [...checks, { name: "forced_for_test", ok: false, detail: "forced failure" }];
}

export function verifyMsg(v: Verdict): Msg {
  const bad = v.checks.filter((c) => !c.ok);
  return bad.length
    ? M("step.verify.fail", { n: bad.length, total: v.checks.length, first: M(`vchk.${bad[0].name}`), detail: bad[0].detail })
    : M("step.verify.ok", { n: v.checks.length });
}

export function logSteps(group: string, agent: AgentId, attempt: number, msgs: StageMsgs, v: Verdict) {
  const s = getSim();
  const st = db().prepare(`INSERT INTO agent_steps(run_group,agent,attempt,stage,summary,tick,sim_date,ok) VALUES(?,?,?,?,?,?,?,?)`);
  const row = (stage: Stage, msg: Msg, ok: boolean) => st.run(group, agent, attempt, stage, JSON.stringify(msg), s.tick, s.sim_date, ok ? 1 : 0);
  row("READ", msgs.read, true);
  row("REASON", msgs.reason, true);
  row("ACT", msgs.act, true);
  row("VERIFY", verifyMsg(v), v.ok);
}

/** Result of the last VERIFY of every agent (for the badge in the Agent panel and the "How the agents work" cards). */
export function lastVerifies(): Record<string, { ok: boolean; attempt: number; tick: number; group: string; msg: Msg; warning: boolean }> {
  const rows = db().prepare(`SELECT s.agent, s.ok, s.attempt, s.tick, s.run_group, s.summary FROM agent_steps s
    WHERE s.stage='VERIFY' AND s.id IN (SELECT MAX(id) FROM agent_steps WHERE stage='VERIFY' GROUP BY agent)`).all() as { agent: string; ok: number; attempt: number; tick: number; run_group: string; summary: string }[];
  return Object.fromEntries(rows.map((r) => [r.agent, { ok: !!r.ok, attempt: r.attempt, tick: r.tick, group: r.run_group, msg: JSON.parse(r.summary) as Msg, warning: !r.ok }]));
}

/** Counts of rows in tables (used for the READ / ACT sentences: "what it read", "what it wrote"). */
export const countRows = (table: string, where = ""): number =>
  (db().prepare(`SELECT COUNT(*) n FROM ${table}${where ? ` WHERE ${where}` : ""}`).get() as { n: number }).n;
