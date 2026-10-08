"use client";
import { useState } from "react";
import { useSnap } from "@/lib/store";
import { useApp, useBusy } from "./ctx";
import { Btn } from "./ui";

const input = "min-h-10 w-full rounded-md border border-line bg-surface px-2 text-sm";

/** Manual actions: emergency order and manual stock movement (purchasing). Same database, same checks, fully recorded. */
export default function ManualPanel() {
  const { T, name, post, confirm, N, U } = useApp();
  const busy = useBusy();
  const items = useSnap((s) => s.items);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [po, setPo] = useState({ item: "", qty: "", emergency: true });
  const [mv, setMv] = useState({ item: "", kind: "receipt", qty: "", reason: "" });
  const run = async (body: Record<string, unknown>) => {
    try { await post("/api/manual", body); setMsg({ ok: true, text: T("manual.done") }); } catch (e) { setMsg({ ok: false, text: String((e as Error).message) }); }
  };
  const itemSel = (v: string, set: (x: string) => void) => (
    <select aria-label={T("manual.item")} className={input} value={v} onChange={(e) => set(e.target.value)}><option value="">{T("choose")}</option>{items.map((i) => <option key={i.item_id} value={i.item_id}>{name(i.item_id)}</option>)}</select>
  );
  const unit = (id: string) => U(items.find((i) => i.item_id === id)?.unit ?? "");
  return (
    <div className="scroll-thin max-h-[560px] overflow-y-auto">
      <p className="px-4 pt-4 text-sm text-muted">{T("manual.sub")}</p>
      <div className="grid gap-5 p-4 md:grid-cols-2">
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run({ type: "po", item: po.item, qty: po.qty, emergency: po.emergency }); }}>
          <h3 className="text-sm font-bold">{T("manual.po")}</h3>
          {itemSel(po.item, (v) => setPo({ ...po, item: v }))}
          <input className={input} type="number" min={1} required placeholder={`${T("manual.qty")} ${unit(po.item)}`} aria-label={T("manual.qty")} value={po.qty} onChange={(e) => setPo({ ...po, qty: e.target.value })} />
          <label className="flex min-h-10 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={po.emergency} onChange={(e) => setPo({ ...po, emergency: e.target.checked })} className="h-4 w-4 accent-[var(--brand)]" />{T("manual.emergency")}</label>
          <Btn type="submit" tone="primary" disabled={busy || !po.item} title={!po.item ? T("manual.pick_item") : undefined}>{T("manual.create_po")}</Btn>
        </form>
        <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); if (await confirm({ title: T("manual.confirm_title"), body: `${T(`mk.${mv.kind}`)}: ${N(Number(mv.qty))} ${unit(mv.item)} — ${name(mv.item)}. ${T("manual.confirm_body")}`, action: T("manual.book") })) run({ type: "movement", ...mv }); }}>
          <h3 className="text-sm font-bold">{T("manual.movement")}</h3>
          {itemSel(mv.item, (v) => setMv({ ...mv, item: v }))}
          <div className="flex gap-2">
            <select aria-label={T("manual.kind")} className={input} value={mv.kind} onChange={(e) => setMv({ ...mv, kind: e.target.value })}>{["receipt", "issue", "adjust"].map((k) => <option key={k} value={k}>{T(`mk.${k}`)}</option>)}</select>
            <input className={input} type="number" required placeholder={mv.kind === "adjust" ? T("manual.signed") : T("manual.qty")} aria-label={T("manual.qty")} value={mv.qty} onChange={(e) => setMv({ ...mv, qty: e.target.value })} />
          </div>
          <input className={input} required placeholder={T("manual.reason")} aria-label={T("manual.reason")} value={mv.reason} onChange={(e) => setMv({ ...mv, reason: e.target.value })} />
          <Btn type="submit" tone="primary" disabled={busy || !mv.item} title={!mv.item ? T("manual.pick_item") : undefined}>{T("manual.book")}</Btn>
        </form>
      </div>
      {msg && <p role="status" className={`mx-4 mb-4 rounded-md px-3 py-2 text-sm ${msg.ok ? "bg-ok-soft text-ok" : "bg-crit-soft text-crit"}`}>{msg.text}</p>}
    </div>
  );
}
