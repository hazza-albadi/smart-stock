import { NextResponse } from "next/server";
import { ensureSeeded } from "@/lib/ensure";
import { snapshot } from "@/lib/snapshot";
import { tick, setRunning, setSpeed, resetSim } from "@/lib/sim";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await ensureSeeded();
  const body = (await req.json().catch(() => ({}))) as { action?: string; speed?: number };
  let tickResult = null;
  switch (body.action) {
    case "tick": tickResult = await tick(); break;
    case "play": setRunning(true); break;
    case "pause": setRunning(false); break;
    case "speed": setSpeed(Number(body.speed)); break;
    case "reset": await resetSim(); break;
    default: return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  return NextResponse.json({ tick: tickResult, snapshot: snapshot() });
}
