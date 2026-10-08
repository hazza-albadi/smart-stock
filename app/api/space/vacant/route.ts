import { handle, body } from "@/lib/api";
import { snapshot } from "@/lib/snapshot";
import { keepWindowVacant } from "@/lib/space/actions";

export const dynamic = "force-dynamic";

/** Keep a free window vacant until a re-evaluation date (optional reason). */
export async function POST(req: Request) {
  const b = await body(req);
  return handle(() => {
    const r = keepWindowVacant({ zone_id: String(b.zone_id), area: Number(b.area), start_date: String(b.start_date), end_date: String(b.end_date), reeval_date: b.reeval_date ? String(b.reeval_date) : undefined, reason: b.reason ? String(b.reason) : undefined });
    return { decision_id: r.decisionId, snapshot: snapshot() };
  });
}
