import { NextResponse } from "next/server";
import { ensureSeeded } from "./ensure";

/** Wraps a route handler: seeds on first use and turns thrown errors into a 400 with the message. */
export async function handle(fn: () => unknown | Promise<unknown>) {
  try {
    ensureSeeded();
    return NextResponse.json(await fn());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
export const body = async (req: Request) => ((await req.json().catch(() => ({}))) ?? {}) as Record<string, any>;
