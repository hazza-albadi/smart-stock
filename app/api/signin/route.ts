import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** The sign-in form has no accounts behind it: whatever is sent (it is never read, stored or logged), the answer is the same error. */
export async function POST(req: Request) {
  return NextResponse.redirect(new URL("/login?error=1", req.url), 303);
}
