"use client";
import { memo, useMemo, useState } from "react";
import { useSnap } from "@/lib/store";
import { useApp } from "./ctx";
import { CardHead, Empty, Pill } from "./ui";

export interface FeedMove {
  seq: number; date: string; tick: number; item_id: string; unit: string; movement_type: "IN" | "OUT"; quantity: number; reference: string;
  balance_after: number; lot_id: string | null; actor: string;
}
const SEV_DOT: Record<string, string> = { critical: "bg-crit", high: "bg-high", info: "bg-info" };
const ROW_H = 64; // fixed row height: rows glide with a transform instead of pushing the page

const MoveRow = memo(function MoveRow({ m, index }: { m: FeedMove; index: number }) {
  const { T, N, U, DT, name } = useApp();
  const inn = m.movement_type === "IN", expired = m.reference === "EXPIRED", manual = m.actor === "user";
  const why = expired ? T("feed.expired") : inn ? (m.reference.startsWith("MANUAL:") ? T("feed.manual_in") : T("feed.delivery")) : m.reference.startsWith("MANUAL:") ? T("feed.manual_out") : T("feed.used");
  return (
    <li className="feed-row absolute inset-x-0 top-0 flex items-center gap-3 border-b border-line px-4" style={{ height: ROW_H, transform: `translateY(${index * ROW_H}px)` }}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base font-bold ${inn ? "bg-ok-soft text-ok" : expired ? "bg-crit-soft text-crit" : "bg-info-soft text-info"}`} aria-hidden>{inn ? "↓" : expired ? "✕" : "↑"}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{name(m.item_id)}</div>
        <div className="truncate text-xs text-muted"><span className="num">{DT(m.tick)}</span> · {why}{manual && <> · <Pill tone="user" icon={false}>{T("you")}</Pill></>}</div>
      </div>
      <div className="w-28 shrink-0 text-end">
        <div dir="ltr" className={`num text-sm font-bold ${inn ? "text-ok" : expired ? "text-crit" : ""}`}>{inn ? "+" : "−"}{N(m.quantity)} <span className="text-xs font-medium text-muted">{U(m.unit)}</span></div>
        <div className="text-xs text-muted">{T("feed.left")} <span className="num font-semibold text-ink">{N(m.balance_after)}</span></div>
      </div>
    </li>
  );
});

export default function FeedPanel({ feed, onMore, moreLeft, flow }: { feed: FeedMove[]; onMore: () => void; moreLeft: boolean; flow: "purchasing" | "space" }) {
  const { T, R, DT } = useApp();
  const allEvents = useSnap((s) => s.events);
  const events = useMemo(() => allEvents.filter((e) => e.flow === flow || e.flow === "both").slice(0, 80), [allEvents, flow]);
  const running = useSnap((s) => s.sim.running);
  const pageSize = useSnap((s) => s.sim.page_size);
  const [tab, setTab] = useState<"moves" | "events">(flow === "space" ? "events" : "moves");
  const [vis, setVis] = useState(60); // only the newest rows are in the DOM: fewer updates per hour
  const rows = feed.slice(0, vis);
  const [older, setOlder] = useState<typeof events>([]);
  const [evDone, setEvDone] = useState(false);
  const all = [...events, ...older.filter((o) => !events.some((e) => e.id === o.id))];
  const loadOlder = async () => {
    const last = all[all.length - 1];
    const more = await fetch(`/api/events?before=${last?.id ?? 0}&limit=${pageSize}&flow=${flow}`).then((r) => r.json());
    setOlder((o) => [...o, ...more]);
    if (more.length < pageSize) setEvDone(true);
  };
  return (
    <section className="card flex h-[520px] flex-col overflow-hidden" aria-label={T("feed.title")}>
      <CardHead
        title={<span className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${running ? "live-dot bg-ok" : "bg-muted"}`} aria-hidden />{T(flow === "space" ? "feed.title_space" : "feed.title")}</span>}
        sub={T(flow === "space" ? "feed.sub_space" : "feed.sub")}
        right={
          <div className="flex overflow-hidden rounded-lg border border-line text-sm font-semibold" role="tablist" aria-label={T("feed.title")}>
            {(["moves", "events"] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-10 px-3 ${tab === k ? "bg-brand text-brand-ink" : "bg-surface2 hover:bg-brand-soft"}`}>{T(k === "moves" ? "feed.moves" : "feed.events")}</button>
            ))}
          </div>
        }
      />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {tab === "moves" ? (
          feed.length === 0 ? <Empty icon="⏵" title={T("feed.empty")} text={T("feed.empty_text")} /> : (
            <>
              <ul className="relative" style={{ height: rows.length * ROW_H }}>{rows.map((m, i) => <MoveRow key={m.seq} m={m} index={i} />)}</ul>
              {(feed.length > vis || moreLeft) && <button type="button" onClick={() => (feed.length > vis ? setVis((v) => v + 60) : onMore())} className="min-h-11 w-full text-sm font-semibold text-brand hover:bg-surface2">{T("loadMore")}</button>}
            </>
          )
        ) : (
          <>
            <ul>
              {all.map((e) => (
                <li key={e.id} className={`flex items-start gap-3 border-b border-line px-4 py-2.5 ${e.actor === "user" ? "bg-brand-soft/40" : ""}`}>
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${SEV_DOT[e.severity] ?? "bg-muted"}`} aria-hidden />
                  <div className="min-w-0 flex-1 text-sm">
                    <div>{e.actor === "user" && <Pill tone="user" icon={false}>{T("you")}</Pill>} {R(e.msg)}</div>
                    <div className="num text-xs text-muted">{DT(e.tick)}</div>
                  </div>
                </li>
              ))}
            </ul>
            {!evDone && <button type="button" onClick={loadOlder} className="min-h-11 w-full text-sm font-semibold text-brand hover:bg-surface2">{T("loadMore")}</button>}
          </>
        )}
      </div>
    </section>
  );
}
