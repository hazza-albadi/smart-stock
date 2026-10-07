import { handle, body } from "@/lib/api";
import { snapshot } from "@/lib/snapshot";
import { createManualPo, manualMovement, createSpaceRequest } from "@/lib/decisions";

export const dynamic = "force-dynamic";

/** Manual actions (emergency PO, manual stock movement, new space request): same database, same agents, audited. */
export async function POST(req: Request) {
  const b = await body(req);
  return handle(() => {
    if (b.type === "po") createManualPo(String(b.item), Number(b.qty), !!b.emergency);
    else if (b.type === "movement") manualMovement({ item: String(b.item), kind: b.kind, qty: Number(b.qty), reason: String(b.reason ?? "") });
    else if (b.type === "request") createSpaceRequest({ company: String(b.company ?? ""), type: String(b.storage ?? ""), area: Number(b.area), months: Number(b.months), from: String(b.from ?? "") });
    else throw new Error("unknown manual action");
    return { snapshot: snapshot() };
  });
}
