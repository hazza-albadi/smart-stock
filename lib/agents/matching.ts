import { db } from "../db";
import { logRun, upsertRec, fmt, type AgentResult } from "../core";
import { approvedAllocations, type Allocation } from "./space";

interface Req {
  request_id: string; company: string; required_storage_type: string; area_needed_m2: number; duration_months: number;
  needed_from: string; notes: string;
}
interface Zone { zone_id: string; rentable: number; allocated: number; rent_allowed: number }
interface Proposal { decision: "APPROVE" | "PARTIAL" | "REJECT"; area: number; allocations: Allocation[]; split?: Allocation[] }

const MIN_PARTIAL_SHARE = 0.25; // below this share of the request we decline instead of offering a fragment

/** Best proposal for one general-storage request against a given remaining rentable area per zone. */
function propose(need: number, avail: Map<string, number>): Proposal {
  const fits = [...avail.entries()].filter(([, a]) => a >= need).sort((a, b) => a[1] - b[1]);
  if (fits.length) return { decision: "APPROVE", area: need, allocations: [{ zone_id: fits[0][0], area: need }] };
  const left = [...avail.entries()].filter(([, a]) => a > 0).sort((a, b) => b[1] - a[1]);
  const total = left.reduce((s, [, a]) => s + a, 0);
  if (total < MIN_PARTIAL_SHARE * need) return { decision: "REJECT", area: 0, allocations: [] };
  const single = left[0];
  const split: Allocation[] = [];
  let rest = need;
  for (const [zid, a] of left) { if (rest <= 0) break; const t = Math.min(a, rest); split.push({ zone_id: zid, area: t }); rest -= t; }
  return { decision: "PARTIAL", area: single[1], allocations: [{ zone_id: single[0], area: single[1] }], split };
}

const fmtAlloc = (a: Allocation[], ar: boolean) => a.map((x) => `${fmt(x.area)} ${ar ? "م²" : "m²"} ${x.zone_id}`).join(" + ");

/** Agent 5 (ACT): proposes a decision + reason for every space request. */
export function matchingAgent(group: string): AgentResult {
  const started = new Date().toISOString();
  const d = db();
  const reqs = d.prepare(`SELECT * FROM space_requests ORDER BY request_id`).all() as Req[];
  const zones = d.prepare(`SELECT zone_id, rentable, allocated, rent_allowed FROM zone_space ORDER BY zone_id`).all() as Zone[];
  const recStatus = new Map((d.prepare(`SELECT request_id, status FROM recommendations WHERE kind='SPACE'`).all() as
    { request_id: string; status: string }[]).map((r) => [r.request_id, r.status]));

  // Rentable area per zone after tenants that were already approved (decided requests only).
  const approved = approvedAllocations();
  const avail = new Map<string, number>();
  for (const z of zones) {
    if (!z.rent_allowed) continue;
    const taken = approved.filter((a) => a.zone_id === z.zone_id).reduce((s, a) => s + a.area, 0);
    avail.set(z.zone_id, Math.max(0, z.rentable - taken));
  }
  const maxZone = [...avail.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["-", 0];

  const open = reqs.filter((r) => !recStatus.has(r.request_id) || recStatus.get(r.request_id) === "PENDING");
  const out = new Map<string, Record<string, unknown>>();
  const props = new Map<string, Proposal>();
  const base = (r: Req) => ({ request_id: r.request_id, company: r.company, requested_m2: r.area_needed_m2, storage: r.required_storage_type,
    months: r.duration_months, needed_from: r.needed_from, max_single_zone_m2: maxZone[1], max_single_zone: maxZone[0] });

  // 1) Types we never rent out.
  for (const r of open.filter((r) => r.required_storage_type !== "general")) {
    const cold = r.required_storage_type === "cold";
    out.set(r.request_id, { ...base(r), decision: "REJECT", area_m2: 0, allocations: [],
      reason_en: cold
        ? "Rejected: cold storage (Z3) is reserved for the company's own fresh/frozen shells and is never rentable."
        : "Rejected: hazardous goods are regulated; the hazardous zone (Z4) is never rentable and Z1/Z5 accept general goods only.",
      reason_ar: cold
        ? "مرفوض: التخزين البارد (Z3) مخصص لقشور الشركة الطازجة/المجمدة وغير قابل للتأجير."
        : "مرفوض: المواد الخطرة منظَّمة؛ منطقة المواد الخطرة (Z4) غير قابلة للتأجير، وZ1/Z5 للبضائع العامة فقط." });
  }

  // 2) Main proposal: every general request is judged on its own against the rentable area (no other pending request is deducted).
  const general = open.filter((r) => r.required_storage_type === "general").sort((a, b) => a.needed_from.localeCompare(b.needed_from));
  for (const r of general) {
    const p = propose(r.area_needed_m2, avail);
    props.set(r.request_id, p);
    const need = r.area_needed_m2;
    if (p.decision === "APPROVE") {
      const z = p.allocations[0].zone_id;
      const a = avail.get(z) ?? 0;
      out.set(r.request_id, { ...base(r), decision: "APPROVE", area_m2: need, allocations: p.allocations,
        reason_en: `Approve ${fmt(need)} m² in ${z}: general goods, ${fmt(a)} m² rentable there (${fmt(a - need)} m² left after this).`,
        reason_ar: `الموافقة على ${fmt(need)} م² في ${z}: بضائع عامة والمتاح هناك ${fmt(a)} م² (يتبقى ${fmt(a - need)} م²).` });
    } else if (p.decision === "PARTIAL") {
      const splitFull = (p.split ?? []).reduce((s, a) => s + a.area, 0) >= need;
      out.set(r.request_id, { ...base(r), decision: "PARTIAL", area_m2: p.area, allocations: p.allocations, split: p.split,
        reason_en: `Cannot fit as one block: ${fmt(need)} m² requested, the largest single block is ${fmt(maxZone[1])} m² (${maxZone[0]}). ` +
          `Propose ${fmt(p.area)} m² in ${p.allocations[0].zone_id}, or a split: ${fmtAlloc(p.split ?? [], false)}${splitFull ? "" : " (still short of the request)"}.`,
        reason_ar: `لا يمكن توفيرها ككتلة واحدة: المطلوب ${fmt(need)} م² وأكبر كتلة منفردة ${fmt(maxZone[1])} م² (${maxZone[0]}). ` +
          `المقترح ${fmt(p.area)} م² في ${p.allocations[0].zone_id}، أو التوزيع: ${fmtAlloc(p.split ?? [], true)}${splitFull ? "" : " (أقل من المطلوب)"}.` });
    } else {
      out.set(r.request_id, { ...base(r), decision: "REJECT", area_m2: 0, allocations: [],
        reason_en: `Reject: ${fmt(need)} m² requested but rentable space is nearly exhausted.`,
        reason_ar: `رفض: المطلوب ${fmt(need)} م² بينما المساحة القابلة للتأجير شبه منتهية.` });
    }
  }

  // 3) Separate note only: what remains if the other proposals are approved first (sequential allocation, earliest start first).
  const seq = new Map(avail);
  const order = [...general].sort((a, b) => {
    const fa = props.get(a.request_id)?.decision === "APPROVE" ? 0 : 1, fb = props.get(b.request_id)?.decision === "APPROVE" ? 0 : 1;
    return fa - fb || a.needed_from.localeCompare(b.needed_from);
  });
  const approvedBefore: string[] = [];
  for (const r of order) {
    const indep = props.get(r.request_id) as Proposal;
    if (indep.decision === "REJECT") continue;
    const s = propose(r.area_needed_m2, seq);
    const o = out.get(r.request_id) as Record<string, unknown>;
    const taken = s.decision === "PARTIAL" ? (s.split ?? s.allocations) : s.allocations;
    const got = taken.reduce((x, a) => x + a.area, 0);
    if (approvedBefore.length && got < Math.min(r.area_needed_m2, indep.decision === "APPROVE" ? indep.area : (indep.split ?? []).reduce((x, a) => x + a.area, 0))) {
      const list = approvedBefore.join(" + ");
      o.note_en = `If ${list} are approved first, only ${fmt(got)} m² would remain for this request${got ? ` (${fmtAlloc(taken, false)})` : ""}.`;
      o.note_ar = `إذا تمت الموافقة على ${list} أولاً، لن يتبقى لهذا الطلب سوى ${fmt(got)} م²${got ? ` (${fmtAlloc(taken, true)})` : ""}.`;
    }
    for (const a of taken) seq.set(a.zone_id, Math.max(0, (seq.get(a.zone_id) ?? 0) - a.area));
    if (indep.decision === "APPROVE") approvedBefore.push(r.request_id);
  }

  d.transaction(() => {
    for (const r of open) {
      const p = out.get(r.request_id);
      if (p) upsertRec(`SPACE:${r.request_id}`, "SPACE", null, r.request_id, p);
    }
  })();

  const parts = [...out.values()].map((p) => `${p.request_id} ${String(p.decision).toLowerCase()}`);
  const res: AgentResult = {
    en: `Evaluated ${open.length} open space request(s) independently: ${parts.join(", ") || "none pending"}. ${reqs.length - open.length} already decided.`,
    ar: `تم تقييم ${open.length} طلب(ات) مساحة مفتوحة بشكل مستقل: ${parts.join("، ") || "لا شيء معلّق"}. ${reqs.length - open.length} تم البت فيها.`,
  };
  logRun(group, "matching", started, res.en, res.ar);
  return res;
}
