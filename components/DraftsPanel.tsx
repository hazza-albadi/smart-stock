"use client";
import { useState } from "react";
import { useSnap } from "@/lib/store";
import type { Snapshot } from "@/lib/snapshot";
import { useApp } from "./ctx";
import { Btn, Empty, Pill } from "./ui";
import SupplierMessage, { messageText } from "./SupplierMessage";

type Draft = Snapshot["drafts"][number];

/** One ready-to-send draft: both languages side by side, editable, marked sent / not sent. The app never sends anything itself. */
function DraftCard({ d }: { d: Draft }) {
  const { T, R, DT, lang, post } = useApp();
  const names = useSnap((s) => s.names);
  const [edit, setEdit] = useState<{ ar: string; en: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const order = lang === "ar" ? (["ar", "en"] as const) : (["en", "ar"] as const);
  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    try { await post("/api/drafts", { id: d.id, ...body }, "PATCH"); } catch { /* the next snapshot shows the real state */ } finally { setBusy(false); }
  };
  return (
    <li className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="Info" icon={false}>{T(`drafts.kind.${d.kind}`)}</Pill>
        <Pill tone={d.sent ? "OK" : "Monitor"}>{d.sent ? T("drafts.sent") : T("drafts.not_sent")}</Pill>
        {d.body_override && <span className="text-xs text-muted">{T("drafts.edited")}</span>}
        <span className="num ms-auto text-xs text-muted">{DT(d.created_tick)}</span>
      </div>
      <p className="mt-1.5 text-sm font-bold">{R(d.subject)}</p>
      <p className="text-xs text-muted">{T("drafts.to")}: {d.to_name ?? T("drafts.to_waiting")}</p>
      {edit ? (
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {order.map((l) => (
            <label key={l} className="block text-xs font-semibold text-muted">{T(`drafts.lang.${l}`)}
              <textarea value={edit[l]} onChange={(e) => setEdit({ ...edit, [l]: e.target.value })} dir={l === "ar" ? "rtl" : "ltr"} lang={l} rows={11}
                className="mt-1 block w-full resize-y rounded-lg border border-line bg-surface p-2.5 text-sm font-normal leading-relaxed text-ink" />
            </label>
          ))}
        </div>
      ) : <SupplierMessage payload={d} />}
      <div className="mt-2 flex flex-wrap gap-2">
        {edit ? (<>
          <Btn tone="primary" disabled={busy} onClick={async () => { await send({ body: edit }); setEdit(null); }}>{T("drafts.save")}</Btn>
          <Btn onClick={() => setEdit(null)}>{T("drafts.cancel")}</Btn>
        </>) : (<>
          <Btn onClick={() => setEdit({ ar: messageText("ar", d, names), en: messageText("en", d, names) })}>{T("drafts.edit")}</Btn>
          <Btn tone={d.sent ? "ghost" : "ok"} disabled={busy} onClick={() => send({ sent: !d.sent })}>{d.sent ? T("drafts.mark_unsent") : T("drafts.mark_sent")}</Btn>
        </>)}
      </div>
    </li>
  );
}

/** Drafts of the current section: supplier orders (Purchasing) or replies to companies (Space). */
export default function DraftsPanel() {
  const { T, section } = useApp();
  const drafts = useSnap((s) => s.drafts);
  const rows = drafts.filter((d) => d.flow === section);
  return (
    <div className="flex h-[560px] flex-col">
      <div className="border-b border-line px-4 py-3"><p className="text-sm text-muted">{T("drafts.note")}</p></div>
      {rows.length === 0 ? <Empty icon="✉" title={T("drafts.empty")} /> : <ul className="scroll-thin min-h-0 flex-1 divide-y divide-line overflow-y-auto">{rows.map((d) => <DraftCard key={d.id} d={d} />)}</ul>}
    </div>
  );
}
