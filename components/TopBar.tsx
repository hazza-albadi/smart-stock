"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSnap } from "@/lib/store";
import { useApp, useBusy } from "./ctx";
import { Btn } from "./ui";

interface Props {
  theme: "light" | "dark"; pauseNote: boolean;
  onPlay: () => void; onPause: () => void; onStep: () => void; onAdvance: (o: { hours?: number; untilDay?: boolean; untilCritical?: boolean }) => void;
  onReset: () => void; onInterval: (ms: number) => void; onAutoPause: (v: boolean) => void;
  onLang: () => void; onTheme: () => void; onHelp: () => void;
}

function Menu({ label, icon, children, align = "start" }: { label: string; icon?: string; children: ReactNode; align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-surface2 px-3 text-sm font-semibold hover:border-brand">{icon && <span aria-hidden>{icon}</span>}{label}<span aria-hidden className="text-xs">▾</span></button>
      {open && <div className={`popover absolute top-12 z-50 w-72 max-w-[88vw] rounded-xl border border-line bg-surface p-3 shadow-xl ${align === "end" ? "end-0" : "start-0"}`}>{children}</div>}
    </div>
  );
}

export default function TopBar(p: Props) {
  const { T, N, R, DL, CK, lang } = useApp();
  const busy = useBusy();
  const s = useSnap((x) => x.sim);
  const [hoursN, setHoursN] = useState("6");
  const [custom, setCustom] = useState("");
  const secs = s.interval_ms / 1000;
  const customMs = Number(custom) * 1000;
  const speedText = R({ k: secs < 10 && secs % 1 ? "top.speed_dec" : "top.speed_int", v: { s: secs } });
  const status = s.running ? T("top.running") : p.pauseNote ? T("top.paused_critical") : T("top.paused");

  const speed = (
    <div className="space-y-2">
      <p className="text-sm font-semibold">{speedText}</p>
      <div className="flex flex-wrap gap-1.5">
        {s.presets.map((ms) => (
          <button key={ms} type="button" aria-pressed={s.interval_ms === ms} onClick={() => p.onInterval(ms)} className={`num min-h-10 rounded-lg border px-3 text-sm font-semibold ${s.interval_ms === ms ? "border-brand bg-brand text-brand-ink" : "border-line bg-surface2 hover:border-brand"}`}>{R({ k: ms < 1000 ? "top.preset_dec" : "top.preset_int", v: { s: ms / 1000 } })}</button>
        ))}
      </div>
      <div className="flex gap-2">
        <input aria-label={T("top.custom")} placeholder={T("top.custom")} type="number" min={s.min_interval_ms / 1000} step={0.1} value={custom} onChange={(e) => setCustom(e.target.value)} className="num min-h-10 w-full rounded-md border border-line bg-surface px-2 text-sm" />
        <Btn disabled={!(customMs >= s.min_interval_ms)} title={!(customMs >= s.min_interval_ms) ? R({ k: "top.custom_min", v: { s: s.min_interval_ms / 1000 } }) : undefined} onClick={() => { p.onInterval(customMs); setCustom(""); }}>{T("top.apply")}</Btn>
      </div>
      <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={s.auto_pause} onChange={(e) => p.onAutoPause(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />{T("top.auto_pause")}
      </label>
      <p className="text-xs text-muted">{T("top.auto_pause_hint")}</p>
    </div>
  );
  const why = s.running ? T("top.pause_first") : undefined;
  const more = (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input aria-label={T("top.hours")} type="number" min={1} max={s.max_advance} value={hoursN} onChange={(e) => setHoursN(e.target.value)} className="num min-h-10 w-20 rounded-md border border-line bg-surface px-2 text-sm" />
        <Btn disabled={busy || s.running} title={why} onClick={() => p.onAdvance({ hours: Number(hoursN) })}>{T("top.run_hours")}</Btn>
      </div>
      <Btn className="w-full" disabled={busy || s.running} title={why} onClick={() => p.onAdvance({ untilDay: true })}>⇥ {T("top.next_day")}</Btn>
      <Btn className="w-full" disabled={busy || s.running} title={why} onClick={() => p.onAdvance({ untilCritical: true })}>⚠ {T("top.next_critical")}</Btn>
      <Btn tone="bad" className="w-full" disabled={busy} onClick={p.onReset}>↺ {T("top.reset")}</Btn>
    </div>
  );
  const prefs = (
    <>
      <Btn onClick={p.onLang} ariaLabel={T("top.language")} title={T("top.language")}>{lang === "ar" ? "EN" : "عربي"}</Btn>
      <Btn onClick={p.onTheme} ariaLabel={T(p.theme === "dark" ? "light" : "dark")} title={T(p.theme === "dark" ? "light" : "dark")}>{p.theme === "dark" ? "☀" : "☾"}</Btn>
    </>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 sm:px-4">
        <div className="hidden items-center gap-2 lg:flex">
          <svg width="32" height="32" viewBox="0 0 34 34" aria-hidden><rect width="34" height="34" rx="9" fill="var(--brand)" /><path d="M6 20c3-4 5-4 8 0s5 4 8 0 4-3 6-1" fill="none" stroke="var(--brand-ink)" strokeWidth="2.2" strokeLinecap="round" /><path d="M6 13c3-4 5-4 8 0s5 4 8 0 4-3 6-1" fill="none" stroke="var(--brand-ink)" strokeOpacity=".55" strokeWidth="2.2" strokeLinecap="round" /></svg>
          <div className="text-lg font-bold tracking-tight">{T("appName")}</div>
        </div>

        <div className="clock-block flex min-h-[56px] items-center gap-3 rounded-xl border border-line bg-surface2 px-3 py-1" role="status" aria-live="off">
          <span className={`h-3 w-3 shrink-0 rounded-full ${s.running ? "live-dot bg-ok" : p.pauseNote ? "bg-crit" : "bg-muted"}`} aria-hidden />
          <div className="min-w-0 leading-tight">
            <div className={`truncate text-xs font-semibold ${p.pauseNote && !s.running ? "text-crit" : "text-muted"}`}>{status} · {speedText}</div>
            <div className="truncate text-base font-bold sm:text-lg"><span>{DL(s.date)}</span> <span className="text-brand">– <span className="num">{CK(s.hour)}</span></span></div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {s.running ? <Btn size="lg" tone="ghost" onClick={p.onPause} className="min-w-[8.5rem]">⏸ {T("top.pause")}</Btn> : <Btn size="lg" tone="primary" onClick={p.onPlay} className="min-w-[8.5rem]">▶ {T("top.play")}</Btn>}
          <Btn size="lg" onClick={p.onStep} disabled={busy || s.running} title={why ?? T("top.step_hint")}>⏭ <span className="hidden sm:inline">{T("top.step")}</span><span className="sm:hidden">{T("top.step_short")}</span></Btn>
        </div>

        <div className="ms-auto hidden items-center gap-2 md:flex">
          <Menu label={T("top.speed")} icon="⏱">{speed}</Menu>
          <Menu label={T("top.more")} icon="⋯" align="end">{more}</Menu>
          <Btn onClick={p.onHelp} ariaLabel={T("help.title")} title={T("help.title")}>? <span className="hidden xl:inline">{T("help.title")}</span></Btn>
          {prefs}
        </div>
        <div className="ms-auto md:hidden">
          <Menu label={T("top.menu")} icon="☰" align="end">
            <div className="space-y-4">{speed}<hr className="border-line" />{more}<hr className="border-line" /><div className="flex gap-2"><Btn onClick={p.onHelp}>? {T("help.title")}</Btn>{prefs}</div></div>
          </Menu>
        </div>
      </div>
    </header>
  );
}
