import { NextResponse, type NextRequest } from "next/server";
import { gate, SESSION_COOKIE } from "./lib/gate";

/** Demo gate (not real security): the workspace and its API need the trial cookie; the website pages and the public routes do not. */
export function middleware(req: NextRequest) {
  const g = gate(req.nextUrl.pathname, req.cookies.get(SESSION_COOKIE)?.value);
  if (g.action === "redirect") return NextResponse.redirect(new URL(g.to, req.url));
  if (g.action === "deny") return NextResponse.json({ error: "not signed in" }, { status: 401 });
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/).*)"] };
