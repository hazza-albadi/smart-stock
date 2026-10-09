import { M, UserError } from "@/lib/core";
import { handle, body } from "@/lib/api";
import { snapshot } from "@/lib/snapshot";
import { runAgent, finishAnalysis } from "@/lib/agents/coordinator";
import { AGENT_ORDER, isAgentId } from "@/lib/agents/registry";
import { polishPendingMessages } from "@/lib/llm";

export const dynamic = "force-dynamic";

/** Runs ONE agent per call ("Run analysis" calls the five in registry order so they can be shown one after another); the last call also writes the summary. */
export async function POST(req: Request) {
  const b = await body(req);
  return handle(async () => {
    if (!isAgentId(b.agent)) throw new UserError(M("err.bad_action"));
    const result = runAgent(b.agent, b.group ?? `manual#${Date.now()}`, "manual");
    if (b.agent === "alerts") await polishPendingMessages();
    if (b.agent === AGENT_ORDER[AGENT_ORDER.length - 1]) finishAnalysis();
    return { result, snapshot: snapshot() };
  });
}
