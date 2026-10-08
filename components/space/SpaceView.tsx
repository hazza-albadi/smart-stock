"use client";
import { useSnap } from "@/lib/store";
import { useApp } from "../ctx";
import FeedPanel, { type FeedMove } from "../FeedPanel";
import { RiskList } from "../RiskPanel";
import { ExplainBtn } from "../ui";
import SpaceQueue from "./SpaceQueue";
import { ComparePanel, ForecastPanel, LeasesPanel, ListingsPanel, UnmatchedPanel } from "./SpacePanels";

const STEPS = ["forecast", "decide", "listing", "offers", "leases"] as const;

/** Flow bar: Forecast -> Decide -> Listing -> Offers -> Leases, with a count per stage and the next action highlighted. */
function FlowBar() {
  const { T, N } = useApp();
  const flow = useSnap((s) => s.space.flow), next = useSnap((s) => s.space.next);
  const target: Record<(typeof STEPS)[number], string> = { forecast: "forecast", decide: "decisions", listing: "listings", offers: "decisions", leases: "leases" };
  return (
    <nav aria-label={T("sp.flow.title")} className="card p-3">
      <ol className="grid grid-cols-5 gap-1.5 sm:gap-2">
        {STEPS.map((k, i) => {
          const isNext = next === k;
          return (
            <li key={k} className="min-w-0">
              <button type="button" onClick={() => document.getElementById(target[k])?.scrollIntoView({ behavior: "smooth", block: "start" })} aria-current={isNext ? "step" : undefined}
                className={`flex min-h-[72px] w-full flex-col items-center justify-center rounded-xl border px-1 py-1.5 text-center transition ${isNext ? "border-brand bg-brand text-brand-ink shadow" : "border-line bg-surface2 hover:border-brand"}`}>
                <span className="num text-xl font-bold leading-none">{N(flow[k])}</span>
                <span className="mt-1 text-[13px] font-semibold leading-tight">{i + 1}. {T(`sp.flow.${k}`)}</span>
                {isNext && <span className="mt-0.5 text-[11px] font-medium opacity-90">{T("sp.flow.next")}</span>}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-muted">{T(`sp.flow.hint.${next}`)}</p>
    </nav>
  );
}

function SpaceKpis() {
  const { T, N, OMR } = useApp();
  const k = useSnap((s) => s.space.kpi), ex = useSnap((s) => s.space.kpi_explain), free = useSnap((s) => s.kpi.rentable_m2);
  const cards = [
    { id: "listable", label: T("sp.kpi.listable"), value: `${N(k.listable_total_m2)} ${T("fmt.m2")}`, sub: `${T("sp.kpi.free_now")} ${N(free)} ${T("fmt.m2")}`, tone: "text-brand", e: ex.listable },
    { id: "market", label: T("sp.kpi.market"), value: `${N(k.listed_m2)} ${T("fmt.m2")}`, sub: `${N(k.offers_waiting)} ${T("sp.kpi.offers_waiting")}`, tone: k.offers_waiting ? "text-high" : "text-brand" },
    { id: "leased", label: T("sp.kpi.leased"), value: `${N(k.leased_m2)} ${T("fmt.m2")}`, sub: T("sp.kpi.leased_sub"), tone: "text-over" },
    { id: "income", label: T("sp.kpi.income"), value: OMR(k.income_total), sub: `${OMR(k.income_per_day)} ${T("sp.kpi.per_day")}`, tone: "text-ok", e: ex.income },
  ];
  return (
    <section className="grid grid-cols-2 gap-3" aria-label={T("sp.kpi.title")}>
      {cards.map((c) => (
        <div key={c.id} className="card min-h-[112px] p-4">
          <div className="flex items-center text-sm font-medium text-muted">{c.label}{c.e && <ExplainBtn e={c.e} />}</div>
          <div className={`num kpi-value mt-1 text-xl font-bold leading-tight xl:text-2xl ${c.tone}`}>{c.value}</div>
          <div className="mt-1 text-sm text-muted">{c.sub}</div>
        </div>
      ))}
      <p className="col-span-2 -mt-1 text-xs text-muted">{T("sp.synthetic_note")}</p>
    </section>
  );
}

/** The Space section: its own flow bar, decisions, risks, KPIs and activity. The top bar and the movement feed are shared with Purchasing. */
export default function SpaceView({ feed, onMore, moreLeft }: { feed: FeedMove[]; onMore: () => void; moreLeft: boolean; flash: Record<string, boolean>; shown: Record<string, number> }) {
  const { T } = useApp();
  return (
    <div className="space-y-4">
      <FlowBar />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7"><SpaceQueue /></div>
        <div className="min-w-0 space-y-4 lg:col-span-5"><SpaceKpis /><RiskList flow="space" /></div>
      </div>
      <ComparePanel />
      <ListingsPanel />
      <LeasesPanel />
      <ForecastPanel />
      <UnmatchedPanel />
      <section aria-label={T("sp.activity")}>
        <h2 className="mb-2 text-lg font-bold">{T("sp.activity")}</h2>
        <FeedPanel feed={feed} onMore={onMore} moreLeft={moreLeft} flow="space" />
      </section>
    </div>
  );
}
