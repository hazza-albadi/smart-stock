import { NextResponse } from "next/server";
import { SESSION_COOKIE, TRIAL_VALUE } from "@/lib/gate";

export const dynamic = "force-dynamic";

/** Trial sign-in: no fields, no account. Sets the demo cookie and opens the workspace. */
export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/simulation", req.url), 303);
  res.cookies.set(SESSION_COOKIE, TRIAL_VALUE, { httpOnly: true, sameSite: "lax", path: "/" });
  return res;
}
