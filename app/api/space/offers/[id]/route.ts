import { handle, body } from "@/lib/api";
import { snapshot } from "@/lib/snapshot";
import { offerAction } from "@/lib/space/actions";

export const dynamic = "force-dynamic";

/** Accept, reject (with a reason) or counter-offer (new area, dates or price). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await body(req);
  return handle(() => {
    if (!["accept", "reject", "counter"].includes(b.action)) throw new Error("bad action");
    const t = b.terms ? { area: Number(b.terms.area), start_date: String(b.terms.start_date), end_date: String(b.terms.end_date), price: Number(b.terms.price) } : undefined;
    const r = offerAction(Number(id), b.action, { reason: b.reason, terms: t });
    return { decision_id: r.decisionId, snapshot: snapshot() };
  });
}
