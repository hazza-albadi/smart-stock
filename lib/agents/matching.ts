import { db } from "../db";
import { addMonths } from "../time";
import { leaseOverlaps } from "../calc";
import { getSim, logRun, upsertRec, M, type AgentResult, type Msg } from "../core";
import { loadSettings } from "../settings";
import { holdingLeases, computeZones } from "./space";

export interface Allocation { zone_id: string; area: number }
interface Req {
  request_id: string; company: string; required_storage_type: string; area_needed_m2: number; duration_months: number;
  needed_from: string; notes: string;
}
interface Zone { zone_id: string; rentable: number; rent_allowed: number }
interface Proposal { decision: "APPROVE" | "PARTIAL" | "REJECT"; area: number; allocations: Allocation[]; split?: Allocation[] }

/** Best proposal for one request against the remaining rentable area per zone. */
export function propose(need: number, avail: Map<string, number>, minShare: number): Proposal {
  const fits = [...avail.entries()].filter(([, a]) => a >= need).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  if (fits.length) return { decision: "APPROVE", area: need, allocations: [{ zone_id: fits[0][0], area: need }] };
  const left = [...avail.entries()].filter(([, a]) => a > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = left.reduce((s, [, a]) => s + a, 0);
  if (total < minShare * need) return { decision: "REJECT", area: 0, allocations: [] };
  const split: Allocation[] = [];
  let rest = need;
  for (const [zid, a] of left) { if (rest <= 0) break; const t = Math.min(a, rest); split.push({ zone_id: zid, area: t }); rest -= t; }
  return { decision: "PARTIAL", area: left[0][1], allocations: [{ zone_id: left[0][0], area: left[0][1] }], split };
}

/** Area each zone can still rent out during [from, to): gross rentable minus leases overlapping the interval. */
export function availableFor(zones: Zone[], from: string, to: string): Map<string, number> {
  const leases = holdingLeases();
  const out = new Map<string, number>();
  for (const z of zones) {
    if (!z.rent_allowed) continue;
    const taken = leases.filter((l) => l.zone_id === z.zone_id && leaseOverlaps(l, from, to)).reduce((s, l) => s + l.area, 0);
    out.set(z.zone_id, Math.max(0, z.rentable - taken));
  }
  return out;
}

export const leaseEnd = (r: { needed_from: string; duration_months: number }, start: string) => addMonths(start, r.duration_months);

const list = (a: Allocation[]) => a.map((x) => `${Math.round(x.area)}|${x.zone_id}`).join(",");

/** Agent 5 (ACT): proposes a decision + reason for every open space request (each judged independently). */
export function matchingAgent(group: string, trigger: string): AgentResult {
  const started = new Date().toISOString();
  const d = db();
  const cfg = loadSettings();
  const sim = getSim();
  const type = cfg.s("space.rentable_request_type"), minShare = cfg.n("space.min_partial_share");
  const reqs = d.prepare(`SELECT * FROM space_requests ORDER BY created_tick, request_id`).all() as Req[];
  const zones: Zone[] = computeZones().map((z) => ({ zone_id: z.zone_id, rentable: z.rentable, rent_allowed: z.rent_allowed }));
  const zoneInfo = new Map((d.prepare(`SELECT zone_id, zone_name, storage_type, rent_allowed FROM warehouse_zones`).all() as
    { zone_id: string; zone_name: string; storage_type: string; rent_allowed: string }[]).map((z) => [z.zone_id, z]));
  const recStatus = new Map((d.prepare(`SELECT request_id, status FROM recommendations WHERE kind='SPACE'`).all() as
    { request_id: string; status: string }[]).map((r) => [r.request_id, r.status]));

  const open = reqs.filter((r) => !recStatus.has(r.request_id) || recStatus.get(r.request_id) === "PENDING");
  const out = new Map<string, Record<string, unknown>>();
  const props = new Map<string, Proposal>();
  const availOf = (r: Req) => {
    const from = r.needed_from > sim.sim_date ? r.needed_from : sim.sim_date;
    return availableFor(zones, from, leaseEnd(r, from));
  };
  const maxOf = (a: Map<string, number>) => [...a.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0] ?? ["-", 0];
  const base = (r: Req) => ({
    request_id: r.request_id, company: r.company, requested_m2: r.area_needed_m2, storage: r.required_storage_type, months: r.duration_months,
    needed_from: r.needed_from,
  });

  // 1) Types we never rent out: no rentable zone holds that storage type.
  for (const r of open.filter((r) => r.required_storage_type !== type)) {
    const z = [...zoneInfo.values()].find((x) => x.storage_type === r.required_storage_type && x.rent_allowed !== "yes");
    out.set(r.request_id, { ...base(r), decision: "REJECT", area_m2: 0, allocations: [],
      reason: [M("space.r.reject_type", { type: r.required_storage_type, zone: z?.zone_name ?? "" })] as Msg[] });
  }

  // 2) Every request of the rentable type is judged on its own against the rentable area (no other pending request is deducted).
  const general = open.filter((r) => r.required_storage_type === type).sort((a, b) => a.needed_from.localeCompare(b.needed_from) || a.request_id.localeCompare(b.request_id));
  for (const r of general) {
    const avail = availOf(r);
    const [mz, mv] = maxOf(avail);
    const p = propose(r.area_needed_m2, avail, minShare);
    props.set(r.request_id, p);
    const need = r.area_needed_m2;
    if (p.decision === "APPROVE") {
      const z = p.allocations[0].zone_id, a = avail.get(z) ?? 0;
      out.set(r.request_id, { ...base(r), decision: "APPROVE", area_m2: need, allocations: p.allocations,
        reason: [M("space.r.approve", { area: need, zone: z, avail: a, left: a - need })] });
    } else if (p.decision === "PARTIAL") {
      const fullSplit = (p.split ?? []).reduce((s, a) => s + a.area, 0) >= need;
      out.set(r.request_id, { ...base(r), decision: "PARTIAL", area_m2: p.area, allocations: p.allocations, split: p.split,
        reason: [M("space.r.partial", { need, max: mv, maxzone: mz, area: p.area, zone: p.allocations[0].zone_id, split: list(p.split ?? []), full: fullSplit ? 1 : 0 })] });
    } else {
      out.set(r.request_id, { ...base(r), decision: "REJECT", area_m2: 0, allocations: [], reason: [M("space.r.reject_full", { need })] });
    }
  }

  // 3) Separate note only: what would remain if the other proposals were approved first (earliest start date first).
  const seq = new Map<string, number>();
  for (const z of zones) if (z.rent_allowed) seq.set(z.zone_id, z.rentable);
  const order = [...general].sort((a, b) => {
    const fa = props.get(a.request_id)?.decision === "APPROVE" ? 0 : 1, fb = props.get(b.request_id)?.decision === "APPROVE" ? 0 : 1;
    return fa - fb || a.needed_from.localeCompare(b.needed_from);
  });
  const before: string[] = [];
  for (const r of order) {
    const indep = props.get(r.request_id) as Proposal;
    if (indep.decision === "REJECT") continue;
    const s = propose(r.area_needed_m2, seq, minShare);
    const o = out.get(r.request_id) as Record<string, unknown>;
    const taken = s.decision === "PARTIAL" ? (s.split ?? s.allocations) : s.allocations;
    const got = taken.reduce((x, a) => x + a.area, 0);
    const want = indep.decision === "APPROVE" ? indep.area : (indep.split ?? []).reduce((x, a) => x + a.area, 0);
    if (before.length && got < Math.min(r.area_needed_m2, want)) o.note = [M("space.note.after", { list: before.join(" + "), got, split: list(taken) })];
    for (const a of taken) seq.set(a.zone_id, Math.max(0, (seq.get(a.zone_id) ?? 0) - a.area));
    if (indep.decision === "APPROVE") before.push(r.request_id);
  }

  d.transaction(() => {
    for (const r of open) {
      const p = out.get(r.request_id);
      if (p) upsertRec(`SPACE:${r.request_id}`, "SPACE", null, r.request_id, p);
    }
  })();

  const counts = { approve: 0, partial: 0, reject: 0 };
  for (const p of out.values()) counts[String(p.decision).toLowerCase() as keyof typeof counts]++;
  const res: AgentResult = { msg: M("run.matching", { open: open.length, decided: reqs.length - open.length, ...counts }) };
  logRun(group, "matching", trigger, started, res.msg);
  return res;
}
