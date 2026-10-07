"use client";
import { tr, nf, type Lang, type Key } from "@/lib/i18n";
import type { Snapshot } from "@/lib/snapshot";
import { ApprovalButtons, CardHead, Pill, pick } from "./ui";

const ZONE_AR: Record<string, string> = {
  Z1: "التخزين العام", Z2: "المواد الخام — جافة", Z3: "التخزين البارد", Z4: "المواد الخطرة", Z5: "الفائض / السائب",
};
const ZONE_EN: Record<string, string> = {
  Z1: "General storage", Z2: "Raw materials – dry", Z3: "Cold storage", Z4: "Hazardous materials", Z5: "Overflow / bulk",
};
const TYPE_AR: Record<string, string> = { general: "عام", cold: "مبرد", hazardous: "خطر" };

export default function SpacePanel({ lang, snap, busy, onDecide }: {
  lang: Lang; snap: Snapshot; busy: boolean; onDecide: (id: number, d: "APPROVED" | "REJECTED") => void;
}) {
  const spaceRecs = new Map(snap.recs.filter((r) => r.kind === "SPACE").map((r) => [r.request_id, r]));
  const total = snap.kpi.rentable_m2;
  // Separate note: what remains rentable if every pending single-block "approve" proposal is accepted.
  const pendApprove = snap.recs.filter((r) => r.kind === "SPACE" && r.status === "PENDING" && r.payload.decision === "APPROVE");
  const afterNote = (() => {
    if (pendApprove.length < 1) return "";
    const left = snap.zones.filter((z) => z.rent_allowed).map((z) => {
      const t = pendApprove.flatMap((r) => r.payload.allocations as { zone_id: string; area: number }[]).filter((a) => a.zone_id === z.zone_id).reduce((s, a) => s + a.area, 0);
      return { z: z.zone_id, v: Math.max(0, z.rentable - z.allocated - t) };
    });
    const ids = pendApprove.map((r) => r.request_id).join(" + ");
    const txt = left.map((x) => `${x.z} ${nf(x.v)}`).join(" · ");
    const tot = nf(left.reduce((s, x) => s + x.v, 0));
    return lang === "ar" ? `ملاحظة: الموافقة على ${ids} تُخفض المتاح إلى ${tot} م² (${txt}).` : `Note: approving ${ids} reduces what remains to ${tot} m² (${txt}).`;
  })();
  const zn = (z: string) => (lang === "ar" ? ZONE_AR[z] : ZONE_EN[z]) ?? z;

  const segs = (z: Snapshot["zones"][number]) => {
    const cap = z.capacity;
    const used = Math.min(z.used, cap);
    const reserved = Math.min(z.reserved, Math.max(0, cap - used));
    const alloc = Math.min(z.allocated, Math.max(0, cap - used - reserved));
    const rentNet = Math.max(0, Math.min(z.rentable - z.allocated, cap - used - reserved - alloc));
    const locked = Math.max(0, cap - used - reserved - alloc - rentNet);
    return { cap, used, reserved, alloc, rentNet, locked };
  };
  const legend: [string, string, Key][] = [
    ["var(--seg-used)", "used", "usedZ"], ["var(--seg-reserved)", "reserved", "reservedZ"], ["var(--seg-alloc)", "alloc", "allocatedZ"],
    ["var(--seg-rent)", "rent", "rentableZ"], ["var(--seg-locked)", "locked", "lockedZ"],
  ];

  return (
    <section id="space" className="card scroll-mt-20 overflow-hidden border-brand/40" aria-label={tr(lang, "spaceTitle")}>
      <div className="border-b border-line bg-brand-soft px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{tr(lang, "spaceTitle")}</h2>
            <p className="text-xs text-muted">{tr(lang, "spaceSub")}</p>
          </div>
          <div className="rounded-xl bg-surface px-4 py-2 text-center ring-1 ring-line">
            <div className="text-[11px] text-muted">{tr(lang, "totalRentable")}</div>
            <div className="text-2xl font-bold text-brand"><span className="num">{nf(total)}</span> <span className="text-sm font-semibold">m²</span></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-0 lg:grid-cols-5">
        <div className="border-b border-line p-4 lg:col-span-2 lg:border-b-0 lg:border-e">
          <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
            {legend.map(([c, , k]) => <span key={k} className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{tr(lang, k)}</span>)}
          </div>
          <ul className="space-y-4">
            {snap.zones.map((z) => {
              const s = segs(z);
              const w = (v: number) => `${(v / s.cap) * 100}%`;
              const net = Math.max(0, z.rentable - z.allocated);
              return (
                <li key={z.zone_id}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-semibold"><span className="num">{z.zone_id}</span> · {zn(z.zone_id)}</span>
                    <span className="num text-xs text-muted">{nf(z.used)} / {nf(z.capacity)} m²</span>
                  </div>
                  <div className={`flex h-6 w-full overflow-hidden rounded-md bg-surface2 ${z.over_capacity > 1 ? "ring-2 ring-crit" : "ring-1 ring-line"}`} role="img"
                    aria-label={`${z.zone_id}: ${tr(lang, "usedZ")} ${nf(s.used)}, ${tr(lang, "rentableZ")} ${nf(net)}`}>
                    <div className="transition-all duration-500" style={{ width: w(s.used), background: "var(--seg-used)" }} />
                    <div className="transition-all duration-500" style={{ width: w(s.reserved), background: "var(--seg-reserved)" }} />
                    <div className="transition-all duration-500" style={{ width: w(s.alloc), background: "var(--seg-alloc)" }} />
                    <div className="transition-all duration-500" style={{ width: w(s.rentNet), background: "var(--seg-rent)" }} />
                    <div className="transition-all duration-500" style={{ width: w(s.locked), background: "var(--seg-locked)" }} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted">
                    {z.rent_allowed ? (
                      <span className="font-semibold text-brand">{tr(lang, "rentableZ")}: <span className="num">{nf(net)}</span> m²</span>
                    ) : (
                      <span>{tr(lang, "lockedZ")} ({lang === "ar" ? "غير مسموح بالتأجير" : "rent not allowed"})</span>
                    )}
                    {z.allocated > 0 && <span className="text-over">{tr(lang, "allocatedZ")}: <span className="num">{nf(z.allocated)}</span></span>}
                    {z.over_capacity > 1 && <span className="font-semibold text-crit">⚠ {tr(lang, "overZ")}: <span className="num">{nf(z.over_capacity)}</span> m²</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="p-4 lg:col-span-3">
          <h3 className="mb-1 text-sm font-bold">{tr(lang, "requests")}</h3>
          {afterNote && <p className="mb-3 text-xs text-muted">{afterNote}</p>}
          <ul className="space-y-2.5">
            {snap.requests.map((r) => {
              const rec = spaceRecs.get(r.request_id);
              const p = rec?.payload;
              return (
                <li key={r.request_id} className="rounded-xl border border-line bg-surface p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="num text-xs font-bold text-muted">{r.request_id}</span>
                        <span className="font-semibold">{r.company}</span>
                        <Pill tone={r.required_storage_type === "general" ? "OK" : "Monitor"}>{lang === "ar" ? TYPE_AR[r.required_storage_type] ?? r.required_storage_type : r.required_storage_type}</Pill>
                      </div>
                      <div className="mt-0.5 text-xs text-muted">
                        {tr(lang, "needs")} <span className="num font-semibold text-ink">{nf(r.area_needed_m2)}</span> m² · <span className="num">{r.duration_months}</span> {tr(lang, "months")} · {tr(lang, "from")} <span className="num">{r.needed_from}</span>
                      </div>
                    </div>
                    {p && (
                      <div className="text-end">
                        <Pill tone={p.decision}>{tr(lang, p.decision as Key)}</Pill>
                        {p.area_m2 > 0 && (
                          <div className="num mt-0.5 text-xs font-semibold">
                            {nf(p.area_m2)} m² · {(p.allocations as { zone_id: string; area: number }[]).map((a) => `${a.zone_id}${p.allocations.length > 1 ? ` ${nf(a.area)}` : ""}`).join(" + ")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {p && <p className="mt-1.5 text-sm text-muted">{pick(lang, p.reason_en, p.reason_ar)}</p>}
                  {p && (p.note_en || p.note_ar) && rec?.status === "PENDING" && (
                    <p className="mt-1 rounded-md bg-mon-soft px-2 py-1 text-xs text-mon">ⓘ {pick(lang, p.note_en, p.note_ar)}</p>
                  )}
                  {rec && (
                    <div className="mt-2 flex justify-end">
                      <ApprovalButtons lang={lang} status={rec.status} busy={busy} onDecide={(d) => onDecide(rec.id, d)} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
