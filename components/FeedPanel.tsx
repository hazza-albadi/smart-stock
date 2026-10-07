"use client";
import { useState } from "react";
import { tr, nf, unitName, type Lang } from "@/lib/i18n";
import type { Snapshot } from "@/lib/snapshot";
import { CardHead, pick } from "./ui";

export interface FeedMove {
  seq: number; date: string; item_id: string; name_ar: string; name_en: string; unit: string; movement_type: "IN" | "OUT";
  quantity: number; reference: string; balance_after: number;
}

// Deterministic pseudo time-of-day (working hours) so each movement has a clock time.
const clock = (seq: number) => `${String(7 + ((seq * 37) % 10)).padStart(2, "0")}:${String((seq * 53) % 60).padStart(2, "0")}`;

const SEV_DOT: Record<string, string> = { critical: "bg-crit", high: "bg-high", info: "bg-info" };

export default function FeedPanel({ lang, feed, events, running }: { lang: Lang; feed: FeedMove[]; events: Snapshot["events"]; running: boolean }) {
  const [tab, setTab] = useState<"moves" | "events">("moves");
  return (
    <section className="card flex h-[640px] flex-col overflow-hidden" aria-label={tr(lang, "feedTitle")}>
      <CardHead
        title={<span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${running ? "live-dot bg-ok" : "bg-muted"}`} />{tr(lang, "feedTitle")}</span>}
        right={
          <div className="flex overflow-hidden rounded-lg border border-line text-xs font-semibold">
            {(["moves", "events"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} aria-pressed={tab === t}
                className={`px-2.5 py-1 ${tab === t ? "bg-brand text-brand-ink" : "bg-surface2 hover:bg-brand-soft"}`}>
                {t === "moves" ? lang === "ar" ? "الحركات" : "Movements" : tr(lang, "eventsTitle")}
              </button>
            ))}
          </div>
        }
      />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {tab === "moves" ? (
          feed.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted">{tr(lang, "feedEmpty")}</p>
          ) : (
            <ul>
              {feed.map((m) => {
                const inn = m.movement_type === "IN";
                const expired = m.reference === "EXPIRED";
                return (
                  <li key={m.seq} className="feed-row flex items-center gap-3 border-b border-line px-4 py-2">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${inn ? "bg-ok-soft text-ok" : expired ? "bg-crit-soft text-crit" : "bg-info-soft text-info"}`} aria-hidden>
                      {inn ? "↓" : "↑"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{pick(lang, m.name_en, m.name_ar)}</div>
                      <div className="truncate text-xs text-muted">
                        {lang === "ar" ? m.name_en : m.name_ar} · <span className="num">{m.date.slice(5)} {clock(m.seq)}</span>
                        {expired ? <span className="font-semibold text-crit"> · {lang === "ar" ? "منتهي الصلاحية" : "EXPIRED"}</span> : inn ? <span> · {m.reference}</span> : null}
                      </div>
                    </div>
                    <div className="shrink-0 text-end">
                      <div dir="ltr" className={`text-sm font-bold ${inn ? "text-ok" : expired ? "text-crit" : ""}`}>
                        {inn ? "+" : "−"}{nf(m.quantity)} <span className="text-[11px] font-medium text-muted">{unitName(lang, m.unit)}</span>
                      </div>
                      <div className="text-[11px] text-muted">{tr(lang, "balance")} <span className="num font-semibold text-ink">{nf(m.balance_after)}</span></div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        ) : (
          <ul>
            {events.map((e) => (
              <li key={e.id} className="flex items-start gap-3 border-b border-line px-4 py-2">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEV_DOT[e.severity] ?? "bg-muted"}`} aria-hidden />
                <div className="min-w-0 flex-1 text-sm">
                  <div>{pick(lang, e.message_en, e.message_ar)}</div>
                  <div className="num text-[11px] text-muted">{e.sim_date} · {e.type}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
