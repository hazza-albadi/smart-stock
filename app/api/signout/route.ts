import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/gate";

export const dynamic = "force-dynamic";

/** Sign out: clears the demo cookie and returns to the home page. */
export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
