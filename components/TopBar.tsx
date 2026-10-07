"use client";
import { tr, type Lang } from "@/lib/i18n";
import { Btn, Spinner } from "./ui";

interface Props {
  lang: Lang; theme: "light" | "dark"; date: string; running: boolean; speed: number; busy: boolean; analysing: boolean;
  onPlay: () => void; onPause: () => void; onStep: () => void; onReset: () => void; onSpeed: (s: number) => void;
  onLang: () => void; onTheme: () => void; onAnalyse: () => void;
}

export default function TopBar(p: Props) {
  const { lang } = p;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden>
            <rect width="34" height="34" rx="9" fill="var(--brand)" />
            <path d="M6 20c3-4 5-4 8 0s5 4 8 0 4-3 6-1" fill="none" stroke="var(--brand-ink)" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M6 13c3-4 5-4 8 0s5 4 8 0 4-3 6-1" fill="none" stroke="var(--brand-ink)" strokeOpacity=".55" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M6 27c3-4 5-4 8 0s5 4 8 0 4-3 6-1" fill="none" stroke="var(--brand-ink)" strokeOpacity=".35" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <div className="leading-tight">
            <div className="text-lg font-bold tracking-tight">{tr(lang, "appName")}</div>
            <div className="hidden text-[11px] text-muted sm:block">{tr(lang, "tagline")}</div>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface2 px-3 py-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${p.running ? "live-dot bg-ok" : "bg-muted"}`} aria-hidden />
          <div className="leading-tight">
            <div className="text-[10px] uppercase text-muted">{tr(lang, "today")} · {tr(lang, p.running ? "running" : "paused")}</div>
            <div className="num text-base font-bold" dir="ltr">{p.date}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {p.running ? (
            <Btn tone="ghost" onClick={p.onPause}>⏸ {tr(lang, "pause")}</Btn>
          ) : (
            <Btn tone="primary" onClick={p.onPlay}>▶ {tr(lang, "play")}</Btn>
          )}
          <Btn tone="ghost" onClick={p.onStep} disabled={p.busy || p.running} title={tr(lang, "step")}>⏭ {tr(lang, "step")}</Btn>
          <div role="group" aria-label={tr(lang, "speed")} className="flex overflow-hidden rounded-lg border border-line">
            {[1, 2, 5].map((s) => (
              <button key={s} type="button" onClick={() => p.onSpeed(s)} aria-pressed={p.speed === s}
                className={`num px-2.5 py-1.5 text-sm font-semibold ${p.speed === s ? "bg-brand text-brand-ink" : "bg-surface2 text-ink hover:bg-brand-soft"}`}>
                {s}x
              </button>
            ))}
          </div>
          <Btn tone="ghost" onClick={p.onReset} disabled={p.busy}>↺ {tr(lang, "reset")}</Btn>
        </div>

        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Btn tone="primary" onClick={p.onAnalyse} disabled={p.analysing}>
            {p.analysing ? <Spinner /> : "✦"} {tr(lang, p.analysing ? "analysing" : "runAnalysis")}
          </Btn>
          <Btn tone="ghost" onClick={p.onLang}>{lang === "ar" ? "EN" : "عربي"}</Btn>
          <Btn tone="ghost" onClick={p.onTheme} title={tr(lang, p.theme === "dark" ? "light" : "dark")}>
            {p.theme === "dark" ? "☀" : "☾"}
          </Btn>
        </div>
      </div>
    </header>
  );
}
