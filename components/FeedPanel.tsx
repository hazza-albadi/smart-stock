"use client";
import { useState } from "react";
import { useApp } from "./ctx";
import { CardHead, Pill } from "./ui";

export interface FeedMove {
  seq: number; date: string; tick: number; item_id: string; unit: string; movement_type: "IN" | "OUT"; quantity: number; reference: string;
  balance_after: number; lot_id: string | null; actor: string;
}
const SEV_DOT: Record<string, string> = { critical: "bg-crit", high: "bg-high", info: "bg-info" };

export default function FeedPanel({ feed, onMore, moreLeft }: { feed: FeedMove[]; onMore: () => void; moreLeft: boolean }) {
  const { snap, T, N, U, R, DT, name, name2, post } = useApp();
  const [tab, setTab] = useState<"moves" | "events">("moves");
  const [older, setOlder] = useState<typeof snap.events>([]);
  const [evDone, setEvDone] = useState(false);
  const running = snap.sim.running;
  const events = [...snap.events, ...older.filter((o) => !snap.events.some((e) => e.id === o.id))];
  const refText = (r: string) => (r === "SALES/ISSUE" ? T("ref.issue") : r === "EXPIRED" ? T("ref.expired") : r.startsWith("MANUAL:") ? `${T("ref.manual")}: ${r.split(":").slice(2).join(":")}` : r);
  const loadOlder = async () => {
    const last = events[events.length - 1];
    const more = await fetch(`/api/events?before=${last?.id ?? 0}&limit=${snap.sim.page_size}`).then((r) => r.json());
    setOlder((o) => [...o, ...more]);
    if (more.length < snap.sim.page_size) setEvDone(true);
  };
  void post;
  return (
    <section className="card flex h-[640px] flex-col overflow-hidden" aria-label={T("feedTitle")}>
      <CardHead
        title={<span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${running ? "live-dot bg-ok" : "bg-muted"}`} />{T("feedTitle")}</span>}
        right={
          <div className="flex overflow-hidden rounded-lg border border-line text-xs font-semibold">
            {(["moves", "events"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k} className={`px-2.5 py-1 ${tab === k ? "bg-brand text-brand-ink" : "bg-surface2 hover:bg-brand-soft"}`}>{T(k === "moves" ? "feed.moves" : "eventsTitle")}</button>
            ))}
          </div>
        }
      />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {tab === "moves" ? (
          feed.length === 0 ? <p className="p-6 text-center text-sm text-muted">{T("feedEmpty")}</p> : (
            <>
              <ul>
                {feed.map((m) => {
                  const inn = m.movement_type === "IN", expired = m.reference === "EXPIRED", manual = m.actor === "user";
                  return (
                    <li key={m.seq} className="feed-row flex items-center gap-3 border-b border-line px-4 py-2">
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${inn ? "bg-ok-soft text-ok" : expired ? "bg-crit-soft text-crit" : "bg-info-soft text-info"}`} aria-hidden>{inn ? "↓" : "↑"}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{name(m.item_id)}</div>
                        <div className="truncate text-xs text-muted">{name2(m.item_id)} · <span className="num">{DT(m.tick)}</span> · {refText(m.reference)} {manual && <Pill tone="user">{T("you")}</Pill>}</div>
                      </div>
                      <div className="shrink-0 text-end">
                        <div dir="ltr" className={`text-sm font-bold ${inn ? "text-ok" : expired ? "text-crit" : ""}`}>{inn ? "+" : "−"}{N(m.quantity)} <span className="text-[11px] font-medium text-muted">{U(m.unit)}</span></div>
                        <div className="text-[11px] text-muted">{T("balance")} <span className="num font-semibold text-ink">{N(m.balance_after)}</span></div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {moreLeft && <button type="button" onClick={onMore} className="w-full p-3 text-sm font-semibold text-brand hover:bg-surface2">{T("loadMore")}</button>}
            </>
          )
        ) : (
          <>
            <ul>
              {events.map((e) => (
                <li key={e.id} className={`flex items-start gap-3 border-b border-line px-4 py-2 ${e.actor === "user" ? "border-s-4 border-s-brand bg-brand-soft/40" : ""}`}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEV_DOT[e.severity] ?? "bg-muted"}`} aria-hidden />
                  <div className="min-w-0 flex-1 text-sm">
                    <div>{e.actor === "user" && <Pill tone="user">{T("you")}</Pill>} {R(e.msg)}</div>
                    <div className="num text-[11px] text-muted">{DT(e.tick)} · {T(`evt.${e.actor === "user" ? "user" : "system"}`)}</div>
                  </div>
                </li>
              ))}
            </ul>
            {!evDone && <button type="button" onClick={loadOlder} className="w-full p-3 text-sm font-semibold text-brand hover:bg-surface2">{T("loadMore")}</button>}
          </>
        )}
      </div>
    </section>
  );
}
