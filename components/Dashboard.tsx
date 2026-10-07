"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Snapshot } from "@/lib/snapshot";
import type { Lang } from "@/lib/i18n";
import { getSnapshot, setSnapshot, useSnap } from "@/lib/store";
import type { Msg } from "@/lib/render";
import { AppCtx, BusyCtx, makeApi, type AppApi } from "./ctx";
import TopBar from "./TopBar";
import DecisionCenter, { DecisionSkeleton } from "./DecisionCenter";
import { KpiStrip, RiskList } from "./RiskPanel";
import FeedPanel, { type FeedMove } from "./FeedPanel";
import StockTable from "./StockTable";
import AgentPanel, { type Analysis } from "./AgentPanel";
import SpacePanel from "./SpacePanel";
import PlanPanel from "./PlanPanel";
import ImpactPanel from "./ImpactPanel";
import ManualPanel from "./ManualPanel";
import SettingsPanel from "./SettingsPanel";
import ItemDrawer from "./ItemDrawer";
import { GuideTour, HelpModal } from "./Help";
import { Btn, Modal, Tabs } from "./ui";

const EMPTY_NAMES = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** All requests go through one queue: a user action can never overlap a tick, and answers are applied in the order they were asked. */
let chain: Promise<unknown> = Promise.resolve();
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}
async function http<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error ?? `${url} ${res.status}`);
  return j as T;
}

interface TickEvent { id: number; severity: string; type: string; msg: Msg; tick: number }
interface TickResult { ignored?: string; movements: FeedMove[]; events: TickEvent[]; critical: TickEvent[]; paused: boolean }
interface Toast { id: number; msg: Msg; undo?: number; tone?: "ok" | "bad" }
interface Confirm { title: string; body: string; action: string; danger?: boolean; resolve: (v: boolean) => void }

export default function Dashboard() {
  const [ready, setReady] = useState(false);
  const [lang, setLang] = useState<Lang>("ar");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [feed, setFeed] = useState<FeedMove[]>([]);
  const [moreLeft, setMoreLeft] = useState(true);
  const [flash, setFlash] = useState<Record<string, boolean>>({});
  const [shown, setShown] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis>({ running: false, step: 0 });
  const [auditing, setAuditing] = useState(false);
  const [pauseEvents, setPauseEvents] = useState<TickEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmDlg, setConfirmDlg] = useState<Confirm | null>(null);
  const [help, setHelp] = useState(false);
  const [tour, setTour] = useState(false);
  const [tab, setTab] = useState("space");

  const queue = useRef<FeedMove[]>([]);
  const draining = useRef(false);
  const toastId = useRef(1);

  const running = useSnap((s) => s.sim.running) ?? false;
  const intervalMs = useSnap((s) => s.sim.interval_ms) ?? 5000;
  const undoSeconds = useSnap((s) => s.sim.undo_seconds) ?? 12;
  const names = useSnap((s) => s.names) ?? EMPTY_NAMES;
  const startDate = useSnap((s) => s.sim.start_date) ?? "1970-01-01";
  const intervalRef = useRef(5000);
  intervalRef.current = intervalMs;

  // ---- language / theme / first-run tour (remembered in the browser) ----
  useEffect(() => {
    try {
      const l = localStorage.getItem("ss-lang") as Lang | null;
      if (l === "ar" || l === "en") setLang(l);
      setTheme((document.documentElement.getAttribute("data-theme") as "light" | "dark") || "light");
      if (!localStorage.getItem("ss-guide-done")) setTour(true);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { document.documentElement.lang = lang; document.documentElement.dir = lang === "ar" ? "rtl" : "ltr"; try { localStorage.setItem("ss-lang", lang); } catch { /* ignore */ } }, [lang]);
  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); try { localStorage.setItem("ss-theme", theme); } catch { /* ignore */ } }, [theme]);
  const closeTour = () => { setTour(false); try { localStorage.setItem("ss-guide-done", "1"); } catch { /* ignore */ } };

  // first load: show the stored state; a reload always resumes PAUSED
  useEffect(() => {
    http<Snapshot>("/api/state").then(async (s) => {
      let cur = s;
      if (s.sim.running) cur = (await http<{ snapshot: Snapshot }>("/api/sim", { action: "pause" })).snapshot;
      setSnapshot(cur);
      setFeed([...cur.recent_movements] as unknown as FeedMove[]);
      setMoreLeft(cur.recent_movements.length >= cur.sim.page_size);
      setReady(true);
    }).catch((e) => setError(String(e)));
  }, []);

  // ---- staggered reveal of movements: rows glide in one after another (transform/opacity only) ----
  const drain = useCallback(() => {
    if (draining.current) return;
    draining.current = true;
    const step = () => {
      const m = queue.current.shift();
      if (!m) { draining.current = false; setShown({}); return; }
      setFeed((f) => [m, ...f].slice(0, 300));
      setShown((s) => ({ ...s, [m.item_id]: m.balance_after }));
      setFlash((f) => ({ ...f, [m.item_id]: true }));
      setTimeout(() => setFlash((f) => { const n = { ...f }; delete n[m.item_id]; return n; }), 900);
      setTimeout(step, Math.max(40, Math.min(300, (intervalRef.current * 0.7) / (queue.current.length + 1))));
    };
    step();
  }, []);

  const applyTick = useCallback((r: TickResult | null) => {
    if (!r) return;
    if (r.movements?.length) {
      const asc = [...r.movements].sort((a, b) => a.seq - b.seq);
      if (intervalRef.current < 1000 || asc.length > 30) setFeed((f) => [...asc.reverse(), ...f].slice(0, 300));
      else { queue.current.push(...asc); drain(); }
    }
    if (r.critical?.length && r.paused) setPauseEvents(r.critical);
  }, [drain]);

  const apply = useCallback((res: { snapshot?: Snapshot; result?: unknown }) => {
    if (res.snapshot) setSnapshot(res.snapshot);
    if (res.result && typeof res.result === "object" && "movements" in (res.result as object)) applyTick(res.result as TickResult);
  }, [applyTick]);

  // ---- the clock loop: the SERVER owns the clock; the browser asks for the next hour naming the hour it expects ----
  useEffect(() => {
    if (!running) return;
    let off = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      const t0 = Date.now();
      try {
        const expected = getSnapshot()?.sim.tick;
        const res = await queued(() => http<{ snapshot: Snapshot; result: TickResult }>("/api/sim", { action: "tick", expected, auto: true }));
        if (off) return;
        apply(res);
      } catch (e) { setError(String((e as Error).message)); return; }
      timer = setTimeout(loop, Math.max(100, intervalRef.current - (Date.now() - t0)));
    };
    loop();
    return () => { off = true; clearTimeout(timer); };
  }, [running, intervalMs, apply]);

  const sim = async (body: Record<string, unknown>) => {
    setBusy(true);
    try { apply(await queued(() => http("/api/sim", body))); } catch (e) { setError(String((e as Error).message)); } finally { setBusy(false); }
  };

  const confirm: AppApi["confirm"] = (o) => new Promise((resolve) => setConfirmDlg({ ...o, resolve }));
  const resetAll = async () => {
    if (!(await confirm({ title: T("top.reset_title"), body: T("top.reset_body"), action: T("top.reset"), danger: true }))) return;
    queue.current = []; setFeed([]); setShown({}); setFlash({}); setPauseEvents(null); setToasts([]);
    await sim({ action: "reset" }); setMoreLeft(false);
  };

  const pushToast = (t: Omit<Toast, "id">) => {
    const id = toastId.current++;
    setToasts((x) => [...x.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), (t.undo ? undoSeconds : 6) * 1000);
  };

  const post = useCallback(async (url: string, body: unknown, method = "POST") => {
    setBusy(true);
    try {
      const res = await queued(() => http<any>(url, body, method));
      if (res && res.snapshot) setSnapshot(res.snapshot);
      return res;
    } finally { setBusy(false); }
  }, []);

  const decisionMsg = (id: number, d: "APPROVED" | "REJECTED"): Msg => {
    const rec = getSnapshot()?.recs.find((r) => r.id === id);
    const p = rec?.payload ?? {};
    if (rec?.kind === "PO") return d === "APPROVED" ? { k: "toast.po_approved", v: { qty: p.qty, unit: p.unit, item: rec.item_id } } : { k: "toast.po_rejected", v: { item: rec.item_id } };
    if (rec?.kind === "SPACE") return { k: d === "APPROVED" ? "toast.space_approved" : "toast.space_rejected", v: { company: p.company } };
    return { k: d === "APPROVED" ? "toast.msg_approved" : "toast.msg_rejected", v: { supplier: p.supplier_name } };
  };
  const decide: AppApi["decide"] = async (id, decision, o) => {
    const msg = decisionMsg(id, decision);
    try { const r = await post(`/api/recommendations/${id}`, { decision, ...o }); pushToast({ msg, undo: r.decision_id, tone: decision === "APPROVED" ? "ok" : "bad" }); }
    catch (e) { setError(String((e as Error).message)); }
  };
  const postpone: AppApi["postpone"] = async (id) => {
    const hours = getSnapshot()?.sim.postpone_hours ?? 24;
    try { await post(`/api/recommendations/${id}`, { postpone: true }, "PATCH"); pushToast({ msg: { k: "toast.postponed", v: { hours } } }); } catch (e) { setError(String((e as Error).message)); }
  };
  const editQty: AppApi["editQty"] = async (id, qty) => { try { await post(`/api/recommendations/${id}`, { qty }, "PATCH"); } catch (e) { setError(String((e as Error).message)); } };
  const undo = async (decisionId: number, toastIdx: number) => {
    setToasts((x) => x.filter((y) => y.id !== toastIdx));
    try { await post("/api/undo", { decision_id: decisionId }); pushToast({ msg: { k: "toast.undone" } }); } catch (e) { setError(String((e as Error).message)); }
  };

  const loadMoreFeed = async () => {
    const last = feed[feed.length - 1];
    const size = getSnapshot()?.sim.page_size ?? 60;
    const more = await queued(() => http<FeedMove[]>(`/api/movements?before=${last?.seq ?? 0}&limit=${size}`, undefined));
    setFeed((f) => [...f, ...more]);
    setMoreLeft(more.length >= size);
  };

  // ---- "Run analysis": the five helpers one after another, visibly ----
  const analyse = async () => {
    const s = getSnapshot();
    if (analysis.running || !s) return;
    const group = `manual#${Date.now()}`;
    setAnalysis({ running: true, step: 0 });
    try {
      for (let i = 0; i < s.agent_order.length; i++) {
        setAnalysis({ running: true, step: i });
        await sleep(450);
        const res = await queued(() => http<{ snapshot: Snapshot }>("/api/agents", { agent: s.agent_order[i], group }));
        setSnapshot(res.snapshot);
        await sleep(300);
      }
    } catch (e) { setError(String((e as Error).message)); }
    setAnalysis({ running: false, step: 0 });
  };

  const audit = async () => {
    setAuditing(true);
    try {
      const r = await queued(() => http<{ snapshot: Snapshot; failures: { name: string; detail: string }[] }>("/api/audit", {}));
      setSnapshot(r.snapshot);
      if (r.failures.length) setError(`${T("health.failed")} ${r.failures.map((f) => `${f.name}: ${f.detail}`).join(" | ")}`);
    } catch (e) { setError(String((e as Error).message)); }
    setAuditing(false);
  };

  const goTab = useCallback((id: string) => { setTab(id); setTimeout(() => document.getElementById("more")?.scrollIntoView({ behavior: "smooth", block: "start" }), 30); }, []);

  const api: AppApi = useMemo(() => ({
    lang, ...makeApi(lang, names, startDate), decide, postpone, editQty, select: setSelected, post, goTab, confirm,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [lang, names, startDate, post, goTab]);
  const { T, R, N } = api;

  const decidedCount = useSnap((s) => s.sim.decided) ?? 0;
  const tick = useSnap((s) => s.sim.tick) ?? 0;

  if (!ready) {
    return (
      <div className="mx-auto max-w-[1500px] space-y-4 p-4" aria-busy="true">
        <div className="skeleton h-16 rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-12"><div className="lg:col-span-7"><DecisionSkeleton /></div><div className="skeleton h-[480px] rounded-xl lg:col-span-5" /></div>
        {error && <div role="alert" className="rounded-lg border border-crit bg-crit-soft px-3 py-2 text-sm text-crit">{error}</div>}
      </div>
    );
  }

  const tabs = [
    { id: "space", label: T("tab.space") }, { id: "plan", label: T("tab.plan") }, { id: "history", label: T("tab.history") },
    { id: "agents", label: T("tab.agents") }, { id: "manual", label: T("tab.manual") }, { id: "settings", label: T("tab.settings") },
  ];

  return (
    <AppCtx.Provider value={api}>
      <BusyCtx.Provider value={busy}>
        <div className="min-h-screen">
          <TopBar theme={theme} pauseNote={!!pauseEvents}
            onPlay={() => { setPauseEvents(null); sim({ action: "play" }); }} onPause={() => sim({ action: "pause" })}
            onStep={() => sim({ action: "tick", expected: getSnapshot()?.sim.tick })} onAdvance={(o) => sim({ action: "advance", ...o })}
            onReset={resetAll} onInterval={(ms) => sim({ action: "interval", ms })} onAutoPause={(v) => sim({ action: "auto_pause", value: v })}
            onLang={() => setLang((l) => (l === "ar" ? "en" : "ar"))} onTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} onHelp={() => setHelp(true)} />

          {/* overlays never push the page: they are fixed */}
          {pauseEvents && !running && (
            <div role="alert" className="fixed inset-x-3 top-[84px] z-30 mx-auto max-w-2xl rounded-xl border-2 border-crit bg-surface p-3 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-crit">⏸ {T("pause.title")}</strong>
                <span className="flex gap-2">
                  <Btn tone="primary" onClick={() => { setPauseEvents(null); document.getElementById("decisions")?.scrollIntoView({ behavior: "smooth" }); }}>{T("pause.decide")}</Btn>
                  <Btn onClick={() => { setPauseEvents(null); sim({ action: "play" }); }}>{T("pause.resume")}</Btn>
                  <Btn onClick={() => setPauseEvents(null)} ariaLabel={T("dismiss")}>✕</Btn>
                </span>
              </div>
              <ul className="mt-1 list-disc ps-5 text-sm">{pauseEvents.slice(0, 3).map((e) => <li key={e.id}>{R(e.msg)}</li>)}</ul>
            </div>
          )}
          {error && (
            <div role="alert" className="fixed inset-x-3 top-[84px] z-30 mx-auto flex max-w-2xl items-start justify-between gap-3 rounded-xl border-2 border-crit bg-crit-soft px-3 py-2 text-sm text-crit shadow-xl">
              <span>{error}</span><button type="button" onClick={() => setError(null)} aria-label={T("dismiss")} className="min-h-10 min-w-10">✕</button>
            </div>
          )}

          <main className="mx-auto max-w-[1500px] space-y-4 px-3 py-4 sm:px-4">
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
              <div className="min-w-0 lg:col-span-7"><DecisionCenter /></div>
              <div className="min-w-0 space-y-4 lg:col-span-5"><KpiStrip /><RiskList /></div>
            </div>

            <section aria-label={T("recent.title")}>
              <h2 className="mb-2 text-lg font-bold">{T("recent.title")}</h2>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                <div className="min-w-0 lg:col-span-5"><FeedPanel feed={feed} onMore={loadMoreFeed} moreLeft={moreLeft} /></div>
                <div className="min-w-0 lg:col-span-7"><StockTable flash={flash} shown={shown} /></div>
              </div>
            </section>

            <section id="more" className="card scroll-mt-24 overflow-hidden" aria-label={T("more.title")}>
              <Tabs label={T("more.title")} value={tab} onChange={setTab} tabs={tabs} />
              <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
                {tab === "space" && <SpacePanel />}
                {tab === "plan" && <PlanPanel />}
                {tab === "history" && <ImpactPanel version={`${Math.floor(tick / 6)}-${decidedCount}`} />}
                {tab === "agents" && <AgentPanel analysis={analysis} onAnalyse={analyse} />}
                {tab === "manual" && <ManualPanel />}
                {tab === "settings" && <SettingsPanel auditing={auditing} onAudit={audit} />}
              </div>
            </section>
            <footer className="pb-24 text-center text-xs text-muted">{T("footer")} · <span className="num">{N(tick)}</span></footer>
          </main>

          {selected && <ItemDrawer itemId={selected} onClose={() => setSelected(null)} />}
          {tour && <GuideTour onDone={closeTour} />}
          {help && <HelpModal onClose={() => setHelp(false)} onTour={() => { setHelp(false); setTour(true); }} />}
          {confirmDlg && (
            <Modal title={confirmDlg.title} onClose={() => { confirmDlg.resolve(false); setConfirmDlg(null); }}>
              <p className="text-sm">{confirmDlg.body}</p>
              <div className="mt-4 flex justify-end gap-2">
                <Btn onClick={() => { confirmDlg.resolve(false); setConfirmDlg(null); }}>{T("confirm.cancel")}</Btn>
                <Btn tone={confirmDlg.danger ? "bad" : "primary"} onClick={() => { confirmDlg.resolve(true); setConfirmDlg(null); }}>{confirmDlg.action}</Btn>
              </div>
            </Modal>
          )}

          <div className="pointer-events-none fixed bottom-4 start-4 z-50 flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
            {toasts.map((t) => (
              <div key={t.id} className={`pointer-events-auto flex items-center justify-between gap-3 rounded-xl border border-s-4 bg-surface px-3 py-2 text-sm shadow-lg ${t.tone === "bad" ? "border-crit" : "border-ok"}`}>
                <span>{R(t.msg)}</span>
                {t.undo !== undefined && <button type="button" onClick={() => undo(t.undo as number, t.id)} className="min-h-10 shrink-0 rounded-lg border border-line px-3 font-semibold text-brand hover:bg-surface2">{T("toast.undo")}</button>}
              </div>
            ))}
          </div>
        </div>
      </BusyCtx.Provider>
    </AppCtx.Provider>
  );
}
