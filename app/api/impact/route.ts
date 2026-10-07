import { handle } from "@/lib/api";
import { impactLog } from "@/lib/impact";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => handle(() => impactLog(Number(new URL(req.url).searchParams.get("limit") ?? 60)));
