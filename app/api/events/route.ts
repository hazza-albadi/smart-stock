import { handle } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => handle(() => {
  const u = new URL(req.url);
  const before = Number(u.searchParams.get("before") ?? 1e12), limit = Math.min(200, Number(u.searchParams.get("limit") ?? 60));
  const flow = u.searchParams.get("flow");
  const flows = flow === "space" ? ["space", "both"] : flow === "purchasing" ? ["purchasing", "both"] : ["purchasing", "space", "both"];
  return (db().prepare(`SELECT * FROM events WHERE id<? AND flow IN (${flows.map(() => "?").join(",")}) ORDER BY id DESC LIMIT ?`).all(before, ...flows, limit) as any[]).map((e) => ({ ...e, msg: JSON.parse(e.msg), meta: e.meta ? JSON.parse(e.meta) : null }));
});
