import { handle, body } from "@/lib/api";
import { snapshot } from "@/lib/snapshot";
import { AGENT_ORDER, runAgent, type AgentName } from "@/lib/agents/coordinator";
import { polishPendingMessages } from "@/lib/llm";

export const dynamic = "force-dynamic";

/** Runs ONE agent per call ("Run analysis" calls the five in order so they can be shown one after another). */
export async function POST(req: Request) {
  const b = await body(req);
  return handle(async () => {
    if (!AGENT_ORDER.includes(b.agent)) throw new Error("unknown agent");
    const result = runAgent(b.agent as AgentName, b.group ?? `manual#${Date.now()}`, "manual");
    if (b.agent === "alerts") await polishPendingMessages();
    return { result, snapshot: snapshot() };
  });
}
