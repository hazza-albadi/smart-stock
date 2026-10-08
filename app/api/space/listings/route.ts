import { handle, body } from "@/lib/api";
import { snapshot } from "@/lib/snapshot";
import { listWindow } from "@/lib/space/actions";

export const dynamic = "force-dynamic";

/** List a free window for rent (publish now, or save as draft). Refused when the forecast says the company needs the space. */
export async function POST(req: Request) {
  const b = await body(req);
  return handle(() => {
    const r = listWindow({ zone_id: String(b.zone_id), area: Number(b.area), start_date: String(b.start_date), end_date: String(b.end_date), price: Number(b.price), publish: b.publish !== false });
    return { decision_id: r.decisionId, listing_id: r.listingId, snapshot: snapshot() };
  });
}
