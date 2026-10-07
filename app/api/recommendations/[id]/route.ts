import { NextResponse } from "next/server";
import { ensureSeeded } from "@/lib/ensure";
import { snapshot } from "@/lib/snapshot";
import { decide } from "@/lib/decisions";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await ensureSeeded();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { decision?: string };
  if (body.decision !== "APPROVED" && body.decision !== "REJECTED") return NextResponse.json({ error: "bad decision" }, { status: 400 });
  try {
    await decide(Number(id), body.decision);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 404 });
  }
  return NextResponse.json({ snapshot: snapshot() });
}
