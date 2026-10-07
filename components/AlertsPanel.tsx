"use client";
import { useState } from "react";
import { tr, nf, unitName, type Lang } from "@/lib/i18n";
import type { Snapshot } from "@/lib/snapshot";
import { ApprovalButtons, CardHead, Pill, STRIPE, pick } from "./ui";

type Rec = Snapshot["recs"][number];

export default function AlertsPanel({ lang, snap, busy, onDecide, onSelect }: {
  lang: Lang; snap: Snapshot; busy: boolean; onDecide: (id: number, d: "APPROVED" | "REJECTED") => void; onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showInfo, setShowInfo] = useState(false);
  const recByKey = new Map(snap.recs.map((r) => [r.key, r]));
  const itemById = new Map(snap.items.map((i) => [i.item_id, i]));
  const main = snap.alerts.filter((a) => a.severity !== "Info");
  const info = snap.alerts.filter((a) => a.severity === "Info");

  const Card = ({ a }: { a: (typeof snap.alerts)[number] }) => {
    const msg: Rec | undefined = a.rec_key ? recByKey.get(a.rec_key) : undefined;
    const showPo = a.item_id && ["STOCKOUT", "DELAYED_PO", "SAFETY_LOW"].includes(a.kind);
    const po: Rec | undefined = showPo ? recByKey.get(`PO:${a.item_id}`) : undefined;
    const it = a.item_id ? itemById.get(a.item_id) : undefined;
    return (
      <li className={`rounded-xl border border-line border-s-4 bg-surface p-3.5 ${STRIPE[a.severity]}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <Pill tone={a.severity}>{tr(lang, a.severity as "Critical")}</Pill>
              <span className="num text-[11px] text-muted">{a.first_sim_date}</span>
            </div>
            <h3 className="text-sm font-bold leading-snug">
              {a.item_id ? (
                <button type="button" onClick={() => onSelect(a.item_id as string)} className="text-start hover:text-brand hover:underline">{pick(lang, a.title_en, a.title_ar)}</button>
              ) : pick(lang, a.title_en, a.title_ar)}
            </h3>
            <p className="mt-1 text-sm text-muted">{pick(lang, a.detail_en, a.detail_ar)}</p>
          </div>
        </div>

        {po && it && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface2 px-3 py-2">
            <div className="text-sm">
              <span className="font-semibold">{lang === "ar" ? "مسودة أمر شراء" : "Draft PO"}:</span>{" "}
              <span className="num font-bold">{nf(po.payload.qty)}</span> {unitName(lang, it.unit)} · <span className="num">{nf(po.payload.cost)}</span> {lang === "ar" ? "ر.ع" : "OMR"} · {tr(lang, "poArrives")} <span className="num">{po.payload.expected_arrival}</span>
            </div>
            <ApprovalButtons lang={lang} status={po.status} busy={busy} onDecide={(d) => onDecide(po.id, d)} />
          </div>
        )}

        {msg && (
          <div className="mt-2 rounded-lg bg-surface2 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" className="text-sm font-semibold text-brand hover:underline" onClick={() => setOpen((o) => ({ ...o, [msg.key]: !o[msg.key] }))} aria-expanded={!!open[msg.key]}>
                ✉ {tr(lang, "draftMessage")} — {msg.payload.supplier_name} {open[msg.key] ? "▴" : "▾"}
              </button>
              <ApprovalButtons lang={lang} status={msg.status} busy={busy} onDecide={(d) => onDecide(msg.id, d)} />
            </div>
            {open[msg.key] && (
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {(lang === "ar" ? (["ar", "en"] as const) : (["en", "ar"] as const)).map((l) => (
                  <pre key={l} dir={l === "ar" ? "rtl" : "ltr"} className="whitespace-pre-wrap rounded-lg border border-line bg-surface p-2.5 font-[inherit] text-xs leading-relaxed">
                    {msg.payload[`body_${l}`]}
                  </pre>
                ))}
              </div>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <section id="alerts" className="card scroll-mt-20" aria-label={tr(lang, "alertsTitle")}>
      <CardHead title={tr(lang, "alertsTitle")} sub={tr(lang, "aiProposes")}
        right={<span className="num rounded-full bg-surface2 px-2.5 py-0.5 text-xs font-semibold">{snap.alerts.length}</span>} />
      <div className="scroll-thin max-h-[640px] overflow-y-auto p-3">
        {snap.alerts.length === 0 && <p className="p-4 text-center text-sm text-muted">{tr(lang, "noAlerts")}</p>}
        <ul className="space-y-2.5">{main.map((a) => <Card key={a.key} a={a} />)}</ul>
        {info.length > 0 && (
          <div className="mt-3">
            <button type="button" className="text-sm font-semibold text-muted hover:text-brand" onClick={() => setShowInfo((s) => !s)} aria-expanded={showInfo}>
              {showInfo ? "▾" : "▸"} {tr(lang, "Info")} <span className="num">({info.length})</span>
            </button>
            {showInfo && <ul className="mt-2 space-y-2.5">{info.map((a) => <Card key={a.key} a={a} />)}</ul>}
          </div>
        )}
      </div>
    </section>
  );
}
