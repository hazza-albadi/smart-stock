"use client";
import { useState } from "react";
import { useApp } from "./ctx";
import { render } from "@/lib/render";
import { ApprovalButtons, CardHead, Pill, SevPill, STRIPE } from "./ui";

const NL = String.fromCharCode(10, 10);

export function SupplierMessage({ rec }: { rec: any }) {
  const { T, lang, snap } = useApp();
  const p = rec.payload;
  const items = Object.fromEntries(snap.items.map((i) => [i.item_id, { name_en: i.name_en, name_ar: i.name_ar }]));
  // each box is rendered in its own language, so the Arabic and the English draft are both always ready to send
  const text = (l: "ar" | "en") =>
    p.body_override ? p.body_override[l] : [render(l, p.subject, { items }), ...p.parts.map((m: any) => render(l, m, { items }))].join(NL);
  const order = lang === "ar" ? (["ar", "en"] as const) : (["en", "ar"] as const);
  return (
    <div className="mt-2 grid gap-2 md:grid-cols-2">
      {order.map((l) => (
        <pre key={l} dir={l === "ar" ? "rtl" : "ltr"} lang={l} className="whitespace-pre-wrap rounded-lg border border-line bg-surface p-2.5 font-[inherit] text-xs leading-relaxed">{text(l)}</pre>
      ))}
      <span className="sr-only">{T("draftMessage")}</span>
    </div>
  );
}

export default function AlertsPanel() {
  const { snap, T, N, OMR, U, R, DT, select, name } = useApp();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showInfo, setShowInfo] = useState(false);
  const recByKey = new Map(snap.recs.map((r) => [r.key, r]));
  const main = snap.alerts.filter((a) => a.severity !== "Info");
  const info = snap.alerts.filter((a) => a.severity === "Info");

  const Card = ({ a }: { a: (typeof snap.alerts)[number] }) => {
    const msg = a.rec_key ? recByKey.get(a.rec_key) : undefined;
    const showPo = a.item_id && ["STOCKOUT", "DELAYED_PO", "SAFETY_LOW", "DECISION_OVERDUE"].includes(a.kind);
    const po = showPo ? recByKey.get(`PO:${a.item_id}`) : undefined;
    return (
      <li className={`rounded-xl border border-line border-s-4 bg-surface p-3.5 ${STRIPE[a.severity]}`}>
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <SevPill sev={a.severity} />
          <span className="text-[11px] text-muted">{T("since")} <span className="num font-semibold">{DT(a.since_tick)}</span></span>
        </div>
        <h3 className="text-sm font-bold leading-snug">
          {a.item_id ? <button type="button" onClick={() => select(a.item_id)} className="text-start hover:text-brand hover:underline">{R(a.title)}</button> : R(a.title)}
        </h3>
        <p className="mt-1 text-sm text-muted"><span className="font-semibold text-ink">{T("alert.why")}: </span>{R(a.detail)}</p>
        {a.ignore_msg && <p className="mt-1.5 rounded-md bg-high-soft px-2 py-1 text-xs font-semibold text-high">⏱ {R(a.ignore_msg)}</p>}
        {po && po.status !== "REJECTED" && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface2 px-3 py-2">
            <div className="text-sm">
              <span className="font-semibold">{T("alert.proposal")}: {T("draftPo")}</span> <span className="num font-bold">{N(po.payload.qty)}</span> {U(po.payload.unit)} · <span className="num">{OMR(po.payload.cost)}</span>
              <span className="text-xs text-muted"> · {T("pendingFor")} <span className="num">{N(po.age_hours)}</span> {T("u.h")}</span>
            </div>
            <ApprovalButtons rec={po} />
          </div>
        )}
        {msg && (
          <div className="mt-2 rounded-lg bg-surface2 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" className="text-sm font-semibold text-brand hover:underline" onClick={() => setOpen((o) => ({ ...o, [msg.key]: !o[msg.key] }))} aria-expanded={!!open[msg.key]}>
                ✉ {T("draftMessage")} — {msg.payload.supplier_name} {open[msg.key] ? "▴" : "▾"}
              </button>
              <ApprovalButtons rec={msg} />
            </div>
            {open[msg.key] && <SupplierMessage rec={msg} />}
          </div>
        )}
        {!po && !msg && a.kind !== "OVERSTOCK" && <p className="mt-2 text-xs text-muted">{T("alert.proposal")}: {T(`alert.prop.${a.kind}`)}</p>}
      </li>
    );
  };
  void name; void Pill;

  return (
    <section id="alerts" className="card scroll-mt-28" aria-label={T("alertsTitle")}>
      <CardHead title={T("alertsTitle")} sub={T("aiProposes")} right={<span className="num rounded-full bg-surface2 px-2.5 py-0.5 text-xs font-semibold">{N(snap.alerts.length)}</span>} />
      <div className="scroll-thin max-h-[680px] overflow-y-auto p-3">
        {snap.alerts.length === 0 && <p className="p-4 text-center text-sm text-muted">{T("noAlerts")}</p>}
        <ul className="space-y-2.5">{main.map((a) => <Card key={a.key} a={a} />)}</ul>
        {info.length > 0 && (
          <div className="mt-3">
            <button type="button" className="text-sm font-semibold text-muted hover:text-brand" onClick={() => setShowInfo((s) => !s)} aria-expanded={showInfo}>{showInfo ? "▾" : "▸"} {T("sev.Info")} <span className="num">({N(info.length)})</span></button>
            {showInfo && <ul className="mt-2 space-y-2.5">{info.map((a) => <Card key={a.key} a={a} />)}</ul>}
          </div>
        )}
      </div>
    </section>
  );
}
