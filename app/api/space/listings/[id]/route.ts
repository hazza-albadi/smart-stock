import { handle, body } from "@/lib/api";
import { snapshot } from "@/lib/snapshot";
import { listingAction } from "@/lib/space/actions";

export const dynamic = "force-dynamic";

const ACTIONS = ["publish", "pause", "resume", "withdraw", "shrink", "reprice"] as const;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body(req);
  return handle(() => {
    if (!(ACTIONS as readonly string[]).includes(b.action)) throw new Error("bad action");
    const r = listingAction(Number(id), b.action, b.area === undefined ? undefined : Number(b.area), b.price === undefined ? undefined : Number(b.price));
    return { decision_id: r.decisionId, snapshot: snapshot() };
  });
}
