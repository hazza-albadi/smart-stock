"use client";
import { useState } from "react";
import { dailyIncome } from "@/lib/calc";
import { useSnap } from "@/lib/store";
import { useApp, useBusy } from "../ctx";
import { Btn, Modal } from "../ui";

type Win = ReturnType<typeof useWindows>[number];
const useWindows = () => useSnap((s) => s.space.windows);
type Offer = ReturnType<typeof useOffers>[number];
const useOffers = () => useSnap((s) => s.space.offers);
const field = "min-h-10 w-full rounded-md border border-line bg-surface px-2 text-sm";

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="block text-sm"><span className="mb-1 block font-semibold">{label}</span>{children}{hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}</label>
);

/** List a free window for rent: confirm area, dates and price. The server checks everything again against the latest forecast. */
export function ListDialog({ w, onClose }: { w: Win; onClose: () => void }) {
  const { T, R, spaceAct } = useApp();
  const busy = useBusy();
  const st = useSnap((s) => s.space.settings);
  const [area, setArea] = useState(String(w.suggest.area));
  const [from, setFrom] = useState(w.suggest.start);
  const [to, setTo] = useState(w.suggest.end);
  const [price, setPrice] = useState(String(w.suggest.price));
  const a = Number(area), p = Number(price);
  const inWindow = from >= w.start && (w.to_horizon || to <= w.end);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
  const problem = !(a >= st.min_block) ? R({ k: "sp.form.min_block", v: { min: st.min_block } }) : a > w.area ? R({ k: "sp.form.too_big", v: { max: w.area } })
    : !inWindow ? R({ k: "sp.form.outside", v: { from: w.start, to: w.end } }) : !(days >= st.min_days) ? R({ k: "sp.form.too_short", v: { min: st.min_days } })
    : !(p > 0) ? T("sp.form.price_needed") : "";
  const aboveBand = p > st.price_market * (1 + st.band_pct / 100);
  const go = async (publish: boolean) => {
    const ok = await spaceAct("/api/space/listings", { zone_id: w.zone_id, area: a, start_date: from, end_date: to, price: p, publish }, { k: publish ? "toast.sp.listed" : "toast.sp.drafted", v: { area: a, zone: w.zone_id } });
    if (ok) onClose();
  };
  return (
    <Modal title={R({ k: "sp.form.list_title", v: { area: w.area, zone: w.zone_id } })} onClose={onClose}>
      <div className="space-y-3">
        <p className="rounded-md bg-surface2 px-3 py-2 text-sm text-muted">{R({ k: w.to_horizon ? "sp.form.window_open" : "sp.form.window", v: { area: w.area, zone: w.zone_id, from: w.start, to: w.end } })}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${T("sp.form.area")} (${T("fmt.m2")})`}><input className={`${field} num`} type="number" min={st.min_block} max={w.area} step={st.step} value={area} onChange={(e) => setArea(e.target.value)} /></Field>
          <Field label={T("sp.form.price")} hint={R({ k: "sp.form.price_hint", v: { suggested: st.price_suggested, market: st.price_market } })}><input className={`${field} num`} type="number" min={0} step={0.1} value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
          <Field label={T("sp.form.from")}><input className={field} type="date" value={from} min={w.start} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={T("sp.form.to")}><input className={field} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        {aboveBand && <p className="rounded-md bg-mon-soft px-3 py-2 text-sm">▲ {R({ k: "sp.form.price_high", v: { market: st.price_market } })}</p>}
        {w.pending_area > 0 && w.pending_note && <p className="rounded-md bg-mon-soft px-3 py-2 text-sm">▲ {R(w.pending_note)}</p>}
        {!problem && <p className="text-sm">{R({ k: "sp.form.income", v: { month: a * p, day: dailyIncome(a, p, st.days_per_month) } })} <span className="text-xs text-muted">({T("sp.synthetic")})</span></p>}
        {problem && <p role="alert" className="rounded-md bg-crit-soft px-3 py-2 text-sm text-crit">{problem}</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Btn onClick={onClose}>{T("confirm.cancel")}</Btn>
          <Btn disabled={busy || !!problem} onClick={() => go(false)}>{T("sp.form.draft")}</Btn>
          <Btn tone="ok" size="lg" disabled={busy || !!problem} onClick={() => go(true)}>{R({ k: "sp.form.publish", v: { area: a, price: p } })}</Btn>
        </div>
      </div>
    </Modal>
  );
}

export function VacantDialog({ w, onClose }: { w: Win; onClose: () => void }) {
  const { T, R, spaceAct } = useApp();
  const busy = useBusy();
  const def = useSnap((s) => s.space.settings.reeval_date);
  const today = useSnap((s) => s.sim.date);
  const [until, setUntil] = useState(def);
  const [reason, setReason] = useState("");
  const go = async () => {
    const ok = await spaceAct("/api/space/vacant", { zone_id: w.zone_id, area: w.area, start_date: w.start, end_date: w.end, reeval_date: until, reason }, { k: "toast.sp.vacant", v: { area: w.area, zone: w.zone_id, until } });
    if (ok) onClose();
  };
  return (
    <Modal title={R({ k: "sp.form.vacant_title", v: { area: w.area, zone: w.zone_id } })} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-muted">{T("sp.form.vacant_text")}</p>
        <Field label={T("sp.form.until")}><input className={field} type="date" value={until} min={today} onChange={(e) => setUntil(e.target.value)} /></Field>
        <Field label={T("sp.form.reason_opt")}><input className={field} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Btn onClick={onClose}>{T("confirm.cancel")}</Btn><Btn tone="primary" size="lg" disabled={busy || until <= today} onClick={go}>{R({ k: "sp.btn.vacant", v: { until } })}</Btn></div>
      </div>
    </Modal>
  );
}

export function CounterDialog({ o, onClose }: { o: Offer; onClose: () => void }) {
  const { T, R, spaceAct } = useApp();
  const busy = useBusy();
  const sg = o.eval?.suggest;
  const [area, setArea] = useState(String(sg?.area ?? o.area));
  const [from, setFrom] = useState(sg?.start ?? o.start_date);
  const [to, setTo] = useState(sg?.end ?? o.end_date);
  const [price, setPrice] = useState(String(sg?.price ?? Math.max(o.price, o.listing_price)));
  const bad = !(Number(area) > 0) || !(Number(price) > 0) || !(from < to);
  const go = async () => {
    const ok = await spaceAct(`/api/space/offers/${o.id}`, { action: "counter", terms: { area: Number(area), start_date: from, end_date: to, price: Number(price) } }, { k: "toast.sp.countered", v: { company: o.company } });
    if (ok) onClose();
  };
  return (
    <Modal title={R({ k: "sp.form.counter_title", v: { company: o.company } })} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-muted">{sg ? T("sp.form.counter_suggest") : T("sp.form.counter_text")}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${T("sp.form.area")} (${T("fmt.m2")})`}><input className={`${field} num`} type="number" min={1} value={area} onChange={(e) => setArea(e.target.value)} /></Field>
          <Field label={T("sp.form.price")}><input className={`${field} num`} type="number" min={0} step={0.1} value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
          <Field label={T("sp.form.from")}><input className={field} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={T("sp.form.to")}><input className={field} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <p className="text-xs text-muted">{T("sp.form.counter_wait")}</p>
        <div className="flex justify-end gap-2"><Btn onClick={onClose}>{T("confirm.cancel")}</Btn><Btn tone="primary" size="lg" disabled={busy || bad} onClick={go}>{T("sp.btn.counter_send")}</Btn></div>
      </div>
    </Modal>
  );
}

const REASONS = ["price", "dates", "area", "need", "other"] as const;
export function RejectDialog({ o, onClose }: { o: Offer; onClose: () => void }) {
  const { T, R, spaceAct } = useApp();
  const busy = useBusy();
  const [reason, setReason] = useState<(typeof REASONS)[number]>("price");
  const go = async () => {
    const ok = await spaceAct(`/api/space/offers/${o.id}`, { action: "reject", reason }, { k: "toast.sp.rejected", v: { company: o.company } });
    if (ok) onClose();
  };
  return (
    <Modal title={R({ k: "sp.form.reject_title", v: { company: o.company } })} onClose={onClose}>
      <div className="space-y-3">
        <fieldset className="space-y-1.5"><legend className="mb-1 text-sm font-semibold">{T("sp.form.reject_why")}</legend>
          {REASONS.map((r) => (
            <label key={r} className="flex min-h-10 items-center gap-2 rounded-md border border-line px-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
              <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />{T(`sp.reject.${r}`)}
            </label>
          ))}
        </fieldset>
        <p className="text-xs text-muted">{T("sp.form.reject_note")}</p>
        <div className="flex justify-end gap-2"><Btn onClick={onClose}>{T("confirm.cancel")}</Btn><Btn tone="bad" size="lg" disabled={busy} onClick={go}>{T("sp.btn.reject_offer")}</Btn></div>
      </div>
    </Modal>
  );
}
