"use client";
import { useState } from "react";
import { useApp } from "./ctx";
import { Btn, Spinner } from "./ui";

interface Props {
  theme: "light" | "dark"; analysing: boolean; auditing: boolean;
  onPlay: () => void; onPause: () => void; onStep: () => void; onAdvance: (o: { hours?: number; untilDay?: boolean; untilCritical?: boolean }) => void;
  onReset: () => void; onInterval: (ms: number) => void; onAutoPause: (v: boolean) => void;
  onLang: () => void; onTheme: () => void; onAnalyse: () => void; onAudit: () => void;
}

export default function TopBar(p: Props) {
  const { snap, T, N, DL, CK, lang, busy } = useApp();
  const s = snap.sim;
  const [hoursN, setHoursN] = useState("6");
  const [custom, setCustom] = useState("");
  const secs = s.interval_ms / 1000;
  const h = snap.health;
  const healthOk = h ? h.passed === h.total : null;
  const customMs = Number(custom) * 1000;
  return (
    <header className="z-30 border-b border-line bg-surface/95 backdrop-blur md:sticky md:top-0">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden>
            <rect width="34" height="34" rx="9" fill="var(--brand)" />
            <path d="M6 20c3-4 5-4 8 0s5 4 8 0 4-3 6-1" fill="none" stroke="var(--brand-ink)" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M6 13c3-4 5-4 8 0s5 4 8 0 4-3 6-1" fill="none" stroke="var(--brand-ink)" strokeOpacity=".55" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M6 27c3-4 5-4 8 0s5 4 8 0 4-3 6-1" fill="none" stroke="var(--brand-ink)" strokeOpacity=".35" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <div className="leading-tight"><div className="text-lg font-bold tracking-tight">{T("appName")}</div><div className="hidden text-[11px] text-muted sm:block">{T("tagline")}</div></div>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface2 px-4 py-1.5" aria-live="off">
          <span className={`h-3 w-3 rounded-full ${s.running ? "live-dot bg-ok" : "bg-muted"}`} aria-hidden />
          <div className="leading-tight">
            <div className="text-[11px] text-muted">{T(s.running ? "running" : "paused")} · {T("day")} <span className="num font-semibold text-ink">{N(s.day + 1)}</span></div>
            <div className="text-lg font-bold sm:text-xl"><span>{DL(s.date)}</span> <span className="text-brand">– <span className="num">{CK(s.hour)}</span></span></div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {s.running ? <Btn onClick={p.onPause}>⏸ {T("pause")}</Btn> : <Btn tone="primary" onClick={p.onPlay}>▶ {T("play")}</Btn>}
          <Btn onClick={p.onStep} disabled={busy || s.running} title={T("step1h")}>⏭ {T("step1h")}</Btn>
          <span className="flex items-center overflow-hidden rounded-lg border border-line">
            <input aria-label={T("runN")} type="number" min={1} max={s.max_advance} value={hoursN} onChange={(e) => setHoursN(e.target.value)} className="num w-14 bg-surface px-2 py-1.5 text-sm focus:outline-none" />
            <button type="button" disabled={busy || s.running} onClick={() => p.onAdvance({ hours: Number(hoursN) })} className="bg-surface2 px-2.5 py-1.5 text-sm font-semibold hover:bg-brand-soft disabled:opacity-50">{T("runN")}</button>
          </span>
          <Btn onClick={() => p.onAdvance({ untilDay: true })} disabled={busy || s.running}>⇥ {T("nextDay")}</Btn>
          <Btn onClick={() => p.onAdvance({ untilCritical: true })} disabled={busy || s.running}>⚠ {T("nextCritical")}</Btn>
          <Btn onClick={p.onReset} disabled={busy}>↺ {T("reset")}</Btn>
        </div>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={T("speed")}>
          <span className="text-xs font-semibold text-muted" aria-live="polite">{T("speed.hour")} = <span className="num text-ink">{N(secs, secs < 1 ? 1 : secs % 1 ? 1 : 0)}</span> {T("u.s")}</span>
          <span className="flex overflow-hidden rounded-lg border border-line">
            {s.presets.map((ms) => (
              <button key={ms} type="button" aria-pressed={s.interval_ms === ms} onClick={() => p.onInterval(ms)}
                className={`num px-2 py-1.5 text-xs font-semibold ${s.interval_ms === ms ? "bg-brand text-brand-ink" : "bg-surface2 hover:bg-brand-soft"}`}>{N(ms / 1000, ms < 1000 ? 1 : 0)}{T("u.s")}</button>
            ))}
          </span>
          <span className="flex items-center overflow-hidden rounded-lg border border-line">
            <input aria-label={T("speed.custom")} placeholder={T("speed.custom")} type="number" min={s.min_interval_ms / 1000} step={0.1} value={custom} onChange={(e) => setCustom(e.target.value)} className="num w-16 bg-surface px-2 py-1.5 text-xs focus:outline-none" />
            <button type="button" disabled={!(customMs >= s.min_interval_ms)} onClick={() => { p.onInterval(customMs); setCustom(""); }} className="bg-surface2 px-2 py-1.5 text-xs font-semibold hover:bg-brand-soft disabled:opacity-50">{T("set")}</button>
          </span>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold">
            <input type="checkbox" checked={s.auto_pause} onChange={(e) => p.onAutoPause(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]" />{T("autoPause")}
          </label>
        </div>

        <div className="ms-auto flex flex-wrap items-center gap-2">
          <button type="button" onClick={p.onAudit} disabled={p.auditing} title={T("health.audit")}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${healthOk === null ? "border-line bg-surface2" : healthOk ? "border-ok bg-ok-soft text-ok" : "border-crit bg-crit-soft text-crit"}`}>
            {p.auditing ? <Spinner /> : healthOk === false ? "⚠" : "✓"} {T("health.title")}{" "}
            {h ? <span className="num">{N(h.passed)}/{N(h.total)}</span> : <span>{T("health.none")}</span>}
          </button>
          <Btn tone="primary" onClick={p.onAnalyse} disabled={p.analysing}>{p.analysing ? <Spinner /> : "✦"} {T(p.analysing ? "analysing" : "runAnalysis")}</Btn>
          <Btn onClick={p.onLang}>{lang === "ar" ? "EN" : "عربي"}</Btn>
          <Btn onClick={p.onTheme} title={T(p.theme === "dark" ? "light" : "dark")}>{p.theme === "dark" ? "☀" : "☾"}</Btn>
        </div>
      </div>
      <nav className="mx-auto flex max-w-[1500px] gap-4 overflow-x-auto px-4 pb-2 text-xs font-semibold text-muted" aria-label="sections">
        {["pending", "alerts", "space", "plan", "impact", "agents", "manual", "settings"].map((a) => <a key={a} href={`#${a}`} className="whitespace-nowrap hover:text-brand">{T(`nav.${a}`)}</a>)}
      </nav>
    </header>
  );
}
