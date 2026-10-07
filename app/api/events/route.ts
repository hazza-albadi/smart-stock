import { handle } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => handle(() => {
  const u = new URL(req.url);
  const before = Number(u.searchParams.get("before") ?? 1e12), limit = Math.min(200, Number(u.searchParams.get("limit") ?? 60));
  return (db().prepare(`SELECT * FROM events WHERE id<? ORDER BY id DESC LIMIT ?`).all(before, limit) as any[]).map((e) => ({ ...e, msg: JSON.parse(e.msg), meta: e.meta ? JSON.parse(e.meta) : null }));
});
