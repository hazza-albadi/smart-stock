import { handle, body } from "@/lib/api";
import { snapshot } from "@/lib/snapshot";
import { undo } from "@/lib/decisions";

export const dynamic = "force-dynamic";

/** Undo a decision while its effects can still be reversed. */
export async function POST(req: Request) {
  const b = await body(req);
  return handle(() => { undo(Number(b.decision_id)); return { snapshot: snapshot() }; });
}
