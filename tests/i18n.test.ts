import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import en from "../locales/en.json";
import ar from "../locales/ar.json";

const E = en as Record<string, string>, A = ar as Record<string, string>;
const walk = (d: string, out: string[] = []) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f.name)) out.push(p); } return out; };
const files = ["lib", "components", "app"].flatMap((d) => walk(d));
const src = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");

test("English and Arabic have exactly the same keys", () => {
  assert.deepEqual(Object.keys(E).sort(), Object.keys(A).sort());
});

test("every translation key used in the code exists (static keys)", () => {
  const used = new Set<string>();
  for (const m of src.matchAll(/\bM\(\s*"([a-z_]+(?:\.[a-z_0-9]+)+)"/g)) used.add(m[1]);
  for (const m of src.matchAll(/\bT\("([A-Za-z0-9_.]+)"\)/g)) used.add(m[1]);
  for (const m of src.matchAll(/(?:formula|label|ex)\(?:? ?"(ex\.[a-z_.]+)"/g)) used.add(m[1]);
  const missing = [...used].filter((k) => !(k in E));
  assert.deepEqual(missing, []);
});

test("dynamic key families are complete", () => {
  const need = ["st.Critical", "st.Low", "st.OK", "st.Overstock", "st.Expiring", "sev.Critical", "sev.High", "sev.Monitor", "sev.Info",
    "plan.FUNDED", "plan.PARTIAL", "plan.DEFERRED", "plan.OVERSTOCK", "plan.REJECTED", "kind.PO", "kind.SUPPLIER_MSG",
    "dec.APPROVE", "dec.REJECT", "dec.PARTIAL", "lease.ACTIVE", "lease.RESERVED", "lease.ENDED", "mk.receipt", "mk.issue", "mk.adjust",
    "agent.forecast", "agent.replenishment", "agent.space", "agent.alerts", "agent.spaceplan",
    "nav.purchasing", "nav.space_flow", "po.OPEN", "po.DELAYED_BY_SUPPLIER",
    "alert.prop.STOCKOUT", "alert.prop.DELAYED_PO", "alert.prop.ANOMALY", "alert.prop.EXPIRY", "alert.prop.SAFETY_LOW", "alert.prop.OVERSTOCK", "alert.prop.LISTING_RISK", "alert.prop.LEASE_OVER", "alert.prop.LEASE_LIMITS_PO", "alert.prop.DECISION_OVERDUE", "alert.prop.SPACE_OVER",
    "sp.conf.high", "sp.conf.medium", "sp.conf.low", "sp.level.ok", "sp.level.warn", "sp.level.bad", "sp.chk.type", "sp.chk.area", "sp.chk.dates", "sp.chk.duration", "sp.chk.price", "sp.chk.needs",
    "sp.lst.DRAFT", "sp.lst.PUBLISHED", "sp.lst.PAUSED", "sp.lst.WITHDRAWN", "sp.lst.LEASED", "sp.off.PENDING", "sp.off.COUNTERED", "sp.off.ACCEPTED", "sp.off.REJECTED", "sp.off.EXPIRED", "sp.off.DECLINED", "sp.off.CLOSED",
    "sp.reject.price", "sp.reject.dates", "sp.reject.area", "sp.reject.need", "sp.reject.other", "sp.flow.forecast", "sp.flow.decide", "sp.flow.listing", "sp.flow.offers", "sp.flow.leases",
    "sp.flow.hint.forecast", "sp.flow.hint.decide", "sp.flow.hint.listing", "sp.flow.hint.offers", "sp.flow.hint.leases", "ev.sp.pause", "ev.sp.resume", "ev.sp.withdraw", "ev.sp.shrink", "ev.sp.publish",
    "impact.sp.head.listing_pause", "impact.sp.head.listing_resume", "impact.sp.head.listing_withdraw", "impact.sp.head.listing_shrink", "impact.sp.head.listing_publish",
    "impact.sp.e.listing_pause", "impact.sp.e.listing_resume", "impact.sp.e.listing_withdraw", "impact.sp.e.listing_shrink", "impact.sp.e.listing_publish", "impact.sp.e.vacant_check", "flow.space", "flow.purchasing",
    "evt.user", "evt.system", "fmt.m2", "fmt.omr", "fmt.from", "fmt.emerg", "fmt.short", "fmt.none", "fmt.ongoing"];
  assert.deepEqual(need.filter((k) => !(k in E)), []);
});

test("placeholders match between English and Arabic templates", () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)(?::\w+)?\}/g)].map((m) => m[1]).sort().join(",");
  const bad = Object.keys(E).filter((k) => names(E[k]) !== names(A[k]));
  assert.deepEqual(bad, []);
});

test("item, supplier and zone names are never typed in components", () => {
  const comp = files.filter((f) => f.startsWith("components")).map((f) => fs.readFileSync(f, "utf8")).join("\n");
  assert.ok(!/SKU-\d|Frozen shrimp|Dried shrimp/.test(comp));
});
