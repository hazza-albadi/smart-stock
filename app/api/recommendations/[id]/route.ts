import { handle, body } from "@/lib/api";
import { snapshot } from "@/lib/snapshot";
import { decide, editQty } from "@/lib/decisions";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body(req);
  return handle(() => {
    if (b.decision !== "APPROVED" && b.decision !== "REJECTED") throw new Error("bad decision");
    decide(Number(id), b.decision, { qty: b.qty, variant: b.variant, area: b.area });
    return { snapshot: snapshot() };
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body(req);
  return handle(() => { editQty(Number(id), Number(b.qty)); return { snapshot: snapshot() }; });
}
