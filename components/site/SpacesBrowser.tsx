"use client";
import { useEffect, useMemo, useState } from "react";
import { num, omrNum, dateMed } from "@/lib/format";
import { has } from "@/lib/i18n";
import type { PublicSpace } from "@/lib/publicSpaces";
import { T } from "./T";

const input = "mt-1 block min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-base text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";
const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const zoneLabel = (name: string) => (has("ar", `zname.${name}`) ? T(`zname.${name}`) : name);
const typeLabel = (type: string) => (has("ar", `stype.${type}`) ? T(`stype.${type}`) : type);
const fill = (tpl: string, v: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");
const bound = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));
const PHONE = /^\+?[0-9٠-٩][0-9٠-٩\s-]{5,17}$/;
const NO_FILTER = { aMin: "", aMax: "", pMin: "", pMax: "", zone: "" };

/** Cards of the spaces on offer (read from /api/public-spaces), filters, and the "Request a visit" form, which validates and stores nothing. */
export default function SpacesBrowser() {
  const [spaces, setSpaces] = useState<PublicSpace[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [f, setF] = useState(NO_FILTER);
  const [chosen, setChosen] = useState<PublicSpace | null>(null);
  const [form, setForm] = useState({ name: "", company: "", phone: "", message: "" });
  const [errs, setErrs] = useState<{ name?: boolean; phone?: boolean }>({});
  const [thanks, setThanks] = useState(false);

  useEffect(() => {
    let off = false;
    fetch("/api/public-spaces").then((r) => r.json()).then((j) => { if (!off) setSpaces(j.spaces ?? []); }).catch(() => { if (!off) setFailed(true); });
    return () => { off = true; };
  }, []);

  const zones = useMemo(() => [...new Set((spaces ?? []).map((s) => s.zone_name))], [spaces]);
  const shown = useMemo(() => (spaces ?? []).filter((s) => {
    const [a0, a1, p0, p1] = [bound(f.aMin), bound(f.aMax), bound(f.pMin), bound(f.pMax)];
    return (a0 === null || s.area >= a0) && (a1 === null || s.area <= a1) && (p0 === null || s.price >= p0) && (p1 === null || s.price <= p1) && (!f.zone || s.zone_name === f.zone);
  }), [spaces, f]);
  const anySample = (spaces ?? []).some((s) => s.sample);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const bad = { name: form.name.trim().length < 2, phone: !PHONE.test(form.phone.trim()) };
    setErrs(bad);
    setThanks(!bad.name && !bad.phone); // nothing is sent or stored
  };

  return (
    <div className="mt-6 space-y-8">
      <form role="search" aria-label={T("site.spaces.filters")} className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => e.preventDefault()}>
        <label className="text-sm font-semibold">{T("site.spaces.area_min")}<input type="number" min="0" inputMode="numeric" value={f.aMin} onChange={(e) => setF({ ...f, aMin: e.target.value })} className={input} /></label>
        <label className="text-sm font-semibold">{T("site.spaces.area_max")}<input type="number" min="0" inputMode="numeric" value={f.aMax} onChange={(e) => setF({ ...f, aMax: e.target.value })} className={input} /></label>
        <label className="text-sm font-semibold">{T("site.spaces.price_min")}<input type="number" min="0" step="0.1" inputMode="decimal" value={f.pMin} onChange={(e) => setF({ ...f, pMin: e.target.value })} className={input} /></label>
        <label className="text-sm font-semibold">{T("site.spaces.price_max")}<input type="number" min="0" step="0.1" inputMode="decimal" value={f.pMax} onChange={(e) => setF({ ...f, pMax: e.target.value })} className={input} /></label>
        <label className="text-sm font-semibold">{T("site.spaces.zone")}
          <select value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })} className={input}>
            <option value="">{T("site.spaces.zone_all")}</option>
            {zones.map((z) => <option key={z} value={z}>{zoneLabel(z)}</option>)}
          </select>
        </label>
        <div className="sm:col-span-2 lg:col-span-5"><button type="button" onClick={() => setF(NO_FILTER)} className={`min-h-10 rounded-lg border border-line bg-surface2 px-4 text-sm font-semibold hover:border-brand ${focus}`}>{T("site.spaces.reset")}</button></div>
      </form>

      {anySample && <p className="rounded-lg border border-mon bg-mon-soft px-3 py-2 text-sm font-semibold text-mon">{T("site.spaces.sample_note")}</p>}

      <section aria-live="polite">
        {failed ? <p className="text-center text-muted">{T("site.spaces.error")}</p>
          : spaces === null ? <p className="text-center text-muted">{T("site.spaces.loading")}</p>
          : spaces.length === 0 ? (
            <div className="rounded-xl border border-line bg-surface p-10 text-center"><h2 className="text-xl font-bold">{T("site.spaces.empty_title")}</h2><p className="mt-1 text-muted">{T("site.spaces.empty_text")}</p></div>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted">{fill(T("site.spaces.count"), { n: num("ar", shown.length) })}</p>
              {shown.length === 0 ? <p className="text-center text-muted">{T("site.spaces.none_match")}</p> : (
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {shown.map((s) => (
                    <li key={s.id} className="flex flex-col rounded-xl border border-line bg-surface p-5">
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="text-lg font-bold">{zoneLabel(s.zone_name)}</h2>
                        {s.sample && <span className="rounded-full bg-mon-soft px-2.5 py-0.5 text-xs font-bold text-mon">{T("site.spaces.sample")}</span>}
                      </div>
                      <dl className="mt-3 space-y-2 text-sm">
                        <div className="flex justify-between gap-2"><dt className="text-muted">{T("site.spaces.area")}</dt><dd className="font-bold">{num("ar", s.area)} {T("fmt.m2")}</dd></div>
                        <div className="flex justify-between gap-2"><dt className="text-muted">{T("site.spaces.price")}</dt><dd className="text-end font-bold">{omrNum("ar", s.price)} {T("fmt.omr")}<span className="block text-xs font-normal text-muted">{T("site.spaces.per")}</span></dd></div>
                        <div className="flex justify-between gap-2"><dt className="text-muted">{T("site.spaces.available")}</dt><dd className="text-end">{s.start && s.end ? fill(T("site.spaces.range"), { from: dateMed("ar", s.start), to: dateMed("ar", s.end) }) : T("site.spaces.dates_open")}</dd></div>
                        <div><dt className="text-muted">{T("site.spaces.conditions")}</dt><dd>{T("site.spaces.storage")}: {typeLabel(s.storage_type)}. {T("site.spaces.cond_general")}</dd></div>
                      </dl>
                      <button type="button" onClick={() => { setChosen(s); setThanks(false); document.getElementById("visit")?.scrollIntoView({ behavior: "smooth" }); }}
                        className={`mt-4 min-h-11 rounded-lg bg-brand px-4 text-sm font-bold text-brand-ink hover:opacity-90 ${focus}`}>{T("site.spaces.visit")}</button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
      </section>

      <section id="visit" aria-labelledby="visit-title" className="max-w-2xl rounded-xl border border-line bg-surface p-5">
        <h2 id="visit-title" className="text-xl font-bold">{T("site.visit.title")}</h2>
        {chosen && <p className="mt-1 text-sm text-muted">{T("site.visit.chosen")}: {zoneLabel(chosen.zone_name)}، {num("ar", chosen.area)} {T("fmt.m2")}</p>}
        <form onSubmit={submit} noValidate className="mt-3 space-y-3">
          <label className="block text-sm font-semibold">{T("site.visit.name")}
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={!!errs.name} aria-describedby={errs.name ? "e-name" : undefined} className={input} />
            {errs.name && <span id="e-name" role="alert" className="mt-1 block text-sm text-crit">{T("site.visit.err_name")}</span>}
          </label>
          <label className="block text-sm font-semibold">{T("site.visit.company")}
            <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className={input} />
          </label>
          <label className="block text-sm font-semibold">{T("site.visit.phone")}
            <input type="tel" dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} aria-invalid={!!errs.phone} aria-describedby={errs.phone ? "e-phone" : undefined} className={input} />
            {errs.phone && <span id="e-phone" role="alert" className="mt-1 block text-sm text-crit">{T("site.visit.err_phone")}</span>}
          </label>
          <label className="block text-sm font-semibold">{T("site.visit.message")}
            <textarea rows={4} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className={`${input} py-2`} />
          </label>
          <button type="submit" className={`min-h-11 rounded-lg bg-brand px-5 text-sm font-bold text-brand-ink hover:opacity-90 ${focus}`}>{T("site.visit.submit")}</button>
          <div aria-live="polite">{thanks && <p role="status" className="rounded-lg border border-ok bg-ok-soft px-3 py-2 text-sm font-semibold text-ok">{T("site.visit.thanks")}</p>}</div>
        </form>
      </section>
    </div>
  );
}
