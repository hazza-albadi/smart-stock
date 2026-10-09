import { NextResponse } from "next/server";
import { ensureSeeded } from "./ensure";
import { M, UserError } from "./core";

/**
 * Wraps a route handler: seeds on first use. A refusal (UserError) becomes a 400 with a message in the user's language;
 * anything else is a server fault: logged and answered with 500 and a plain-language message (the transaction was rolled back, nothing changed).
 */
export async function handle(fn: () => unknown | Promise<unknown>) {
  try {
    ensureSeeded();
    return NextResponse.json(await fn());
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message, msg: e.msg }, { status: 400 });
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[api] server error:", e);
    return NextResponse.json({ error: detail, msg: M("err.server", { detail }) }, { status: 500 });
  }
}
export const body = async (req: Request) => ((await req.json().catch(() => ({}))) ?? {}) as Record<string, any>;
