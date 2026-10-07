"use client";
import { useState } from "react";
import { useApp } from "./ctx";
import { Btn, CardHead } from "./ui";

const input = "w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm focus:border-brand focus:outline-none";

/** Manual actions: emergency PO, manual stock movement, new space request. They use the same database and agents and are audited. */
export default function ManualPanel() {
  const { snap, T, name, post, busy } = useApp();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [po, setPo] = useState({ item: "", qty: "", emergency: true });
  const [mv, setMv] = useState({ item: "", kind: "receipt", qty: "", reason: "" });
  const [rq, setRq] = useState({ company: "", storage: "", area: "", months: "3", from: "" });
  const types = [...new Set(snap.requests.map((r) => r.required_storage_type))];
  const run = async (body: Record<string, unknown>, ok: string) => {
    try { await post("/api/manual", body); setMsg({ ok: true, text: ok }); } catch (e) { setMsg({ ok: false, text: String((e as Error).message) }); }
  };
  const itemSel = (v: string, set: (x: string) => void) => (
    <select aria-label={T("item")} className={input} value={v} onChange={(e) => set(e.target.value)}><option value="">{T("choose")}</option>{snap.items.map((i) => <option key={i.item_id} value={i.item_id}>{name(i.item_id)}</option>)}</select>
  );
  return (
    <section id="manual" className="card scroll-mt-28" aria-label={T("manualTitle")}>
      <CardHead title={T("manualTitle")} sub={T("manualSub")} />
      <div className="grid gap-4 p-4 md:grid-cols-3">
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run({ type: "po", item: po.item, qty: po.qty, emergency: po.emergency }, T("manual.done")); }}>
          <h3 className="text-sm font-bold">{T("manual.po")}</h3>
          {itemSel(po.item, (v) => setPo({ ...po, item: v }))}
          <input className={input} type="number" min={1} required placeholder={T("qty")} aria-label={T("qty")} value={po.qty} onChange={(e) => setPo({ ...po, qty: e.target.value })} />
          <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={po.emergency} onChange={(e) => setPo({ ...po, emergency: e.target.checked })} className="accent-[var(--brand)]" />{T("manual.emergency")}</label>
          <Btn type="submit" tone="primary" disabled={busy || !po.item}>{T("manual.createPo")}</Btn>
        </form>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run({ type: "movement", ...mv }, T("manual.done")); }}>
          <h3 className="text-sm font-bold">{T("manual.movement")}</h3>
          {itemSel(mv.item, (v) => setMv({ ...mv, item: v }))}
          <div className="flex gap-2">
            <select aria-label={T("manual.kind")} className={input} value={mv.kind} onChange={(e) => setMv({ ...mv, kind: e.target.value })}>{["receipt", "issue", "adjust"].map((k) => <option key={k} value={k}>{T(`mk.${k}`)}</option>)}</select>
            <input className={input} type="number" required placeholder={mv.kind === "adjust" ? T("manual.signed") : T("qty")} aria-label={T("qty")} value={mv.qty} onChange={(e) => setMv({ ...mv, qty: e.target.value })} />
          </div>
          <input className={input} required placeholder={T("manual.reason")} aria-label={T("manual.reason")} value={mv.reason} onChange={(e) => setMv({ ...mv, reason: e.target.value })} />
          <Btn type="submit" tone="primary" disabled={busy || !mv.item}>{T("manual.book")}</Btn>
        </form>
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); run({ type: "request", ...rq }, T("manual.done")); }}>
          <h3 className="text-sm font-bold">{T("manual.request")}</h3>
          <input className={input} required placeholder={T("manual.company")} aria-label={T("manual.company")} value={rq.company} onChange={(e) => setRq({ ...rq, company: e.target.value })} />
          <div className="flex gap-2">
            <select aria-label={T("manual.storage")} required className={input} value={rq.storage} onChange={(e) => setRq({ ...rq, storage: e.target.value })}><option value="">{T("choose")}</option>{types.map((x) => <option key={x} value={x}>{T(`stype.${x}`) === `stype.${x}` ? x : T(`stype.${x}`)}</option>)}</select>
            <input className={input} type="number" min={1} required placeholder={T("fmt.m2")} aria-label={T("fmt.m2")} value={rq.area} onChange={(e) => setRq({ ...rq, area: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <input className={input} type="number" min={1} required aria-label={T("months")} placeholder={T("months")} value={rq.months} onChange={(e) => setRq({ ...rq, months: e.target.value })} />
            <input className={input} type="date" required aria-label={T("from")} value={rq.from} onChange={(e) => setRq({ ...rq, from: e.target.value })} />
          </div>
          <Btn type="submit" tone="primary" disabled={busy}>{T("manual.addRequest")}</Btn>
        </form>
      </div>
      {msg && <p role="status" className={`mx-4 mb-4 rounded-md px-3 py-2 text-sm ${msg.ok ? "bg-ok-soft text-ok" : "bg-crit-soft text-crit"}`}>{msg.text}</p>}
    </section>
  );
}
