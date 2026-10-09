import { handle, body } from "@/lib/api";
import { snapshot } from "@/lib/snapshot";
import { updateDraft } from "@/lib/drafts";

export const dynamic = "force-dynamic";

/** Edit the wording of a draft and / or mark it as sent or not sent. The app never sends anything itself. */
export async function PATCH(req: Request) {
  const b = await body(req);
  return handle(() => { updateDraft(Number(b.id), { body: b.body, sent: b.sent === undefined ? undefined : !!b.sent }); return { snapshot: snapshot() }; });
}
