import { handle } from "@/lib/api";
import { runInvariants, recordAudit } from "@/lib/audit";
import { snapshot } from "@/lib/snapshot";

export const dynamic = "force-dynamic";

/** Runs all invariant checks on the live database and stores the result for the "Data health" indicator. */
export const POST = () => handle(() => {
  const checks = runInvariants(true);
  const r = recordAudit("live", checks);
  return { ...r, checks, snapshot: snapshot() };
});
