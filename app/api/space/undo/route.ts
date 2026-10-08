import { handle, body } from "@/lib/api";
import { snapshot } from "@/lib/snapshot";
import { undoSpaceDecision } from "@/lib/space/actions";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = await body(req);
  return handle(() => { undoSpaceDecision(Number(b.decision_id)); return { snapshot: snapshot() }; });
}
