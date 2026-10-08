import { getSim } from "../core";
import { runAll } from "../agents/coordinator";
import { acceptOffer, counterOffer, createListing, keepVacant, rejectOffer, setListingStatus, undoSpace, type ListInput, type Terms } from "./market";

/** Every decision of the space flow, followed by the agents so that forecast, alerts and the other flow react in the same hour. */
const react = (what: string) => runAll({ group: `${getSim().tick}#${what}`, trigger: "decision" });

export function listWindow(i: ListInput) { const r = createListing(i); react("listing"); return r; }
export function keepWindowVacant(i: Parameters<typeof keepVacant>[0]) { const r = keepVacant(i); react("vacant"); return r; }
export function listingAction(id: number, action: Parameters<typeof setListingStatus>[1], area?: number, price?: number) { const r = setListingStatus(id, action, area, price); react("listing"); return r; }
export function offerAction(id: number, action: "accept" | "reject" | "counter", o: { reason?: string; terms?: Terms } = {}) {
  const r = action === "accept" ? acceptOffer(id) : action === "reject" ? rejectOffer(id, o.reason ?? "other") : counterOffer(id, o.terms as Terms);
  react("offer");
  return r;
}
export function undoSpaceDecision(id: number) { undoSpace(id); react("undo"); }
