import { NextResponse } from "next/server";
import { ensureSeeded } from "@/lib/ensure";
import { snapshot } from "@/lib/snapshot";
import { AGENT_ORDER, runAgent, type AgentName } from "@/lib/agents/coordinator";
import { llmEnabled } from "@/lib/llm";

export const dynamic = "force-dynamic";

/** Runs ONE agent per call so the UI can show the five agents working one after another. */
export async function POST(req: Request) {
  await ensureSeeded();
  const body = (await req.json().catch(() => ({}))) as { agent?: AgentName; group?: string };
  if (!body.agent || !AGENT_ORDER.includes(body.agent)) return NextResponse.json({ error: "unknown agent" }, { status: 400 });
  const result = await runAgent(body.agent, body.group ?? `manual#${Date.now()}`, llmEnabled());
  return NextResponse.json({ result, snapshot: snapshot() });
}
