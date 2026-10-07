"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Snapshot } from "@/lib/snapshot";
import type { Lang } from "@/lib/i18n";
import { AppCtx, makeApi, type AppApi } from "./ctx";
import TopBar from "./TopBar";
import KpiStrip from "./KpiStrip";
import FeedPanel, { type FeedMove } from "./FeedPanel";
import StockTable from "./StockTable";
import PendingPanel from "./PendingPanel";
import AlertsPanel from "./AlertsPanel";
import AgentPanel, { type Analysis } from "./AgentPanel";
import SpacePanel from "./SpacePanel";
import PlanPanel from "./PlanPanel";
import ImpactPanel from "./ImpactPanel";
import ManualPanel from "./ManualPanel";
import SettingsPanel from "./SettingsPanel";
import ItemDrawer from "./ItemDrawer";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function http<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error ?? `${url} ${res.status}`);
  return j as T;
}

interface TickEvent { id: number; severity: string; type: string; msg: any; tick: number }
interface TickResult { ignored?: string; movements: FeedMove[]; events: TickEvent[]; critical: TickEvent[]; paused: boolean }

export default function Dashboard() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
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
  const [banner, setBanner] = useState<{ kind: "pause" | "audit"; events?: TickEvent[]; text?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const queue = useRef<FeedMove[]>([]);
  const draining = useRef(false);
  const intervalMs = useRef(5000);
  const tickRef = useRef(0);
  if (snap) { intervalMs.current = snap.sim.interval_ms; tickRef.current = snap.sim.tick; }
  const running = snap?.sim.running ?? false;
  const loaded = useRef(false);

  // ---- language / theme (persisted in the browser) ----
  useEffect(() => {
    try {
      const l = localStorage.getItem("ss-lang") as Lang | null;
      if (l === "ar" || l === "en") setLang(l);
      setTheme((document.documentElement.getAttribute("data-theme") as "light" | "dark") || "light");
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { document.documentElement.lang = lang; document.documentElement.dir = lang === "ar" ? "rtl" : "ltr"; try { localStorage.setItem("ss-lang", lang); } catch { /* ignore */ } }, [lang]);
  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); try { localStorage.setItem("ss-theme", theme); } catch { /* ignore */ } }, [theme]);

  // first load: show the stored state; a reload always resumes PAUSED
  useEffect(() => {
    http<Snapshot>("/api/state").then(async (s) => {
      let cur = s;
      if (s.sim.running) cur = (await http<{ snapshot: Snapshot }>("/api/sim", { action: "pause" })).snapshot;
      setSnap(cur);
      setFeed([...cur.recent_movements].reverse().reverse() as unknown as FeedMove[]);
      setMoreLeft(cur.recent_movements.length >= cur.sim.page_size);
      loaded.current = true;
    }).catch((e) => setError(String(e)));
  }, []);

  // ---- staggered reveal of movements: rows appear one after another and flash the stock row ----
  const drain = useCallback(() => {
    if (draining.current) return;
    draining.current = true;
    const step = () => {
      const m = queue.current.shift();
      if (!m) { draining.current = false; setShown({}); return; }
      setFeed((f) => [m, ...f].slice(0, 400));
      setShown((s) => ({ ...s, [m.item_id]: m.balance_after }));
      setFlash((f) => ({ ...f, [m.item_id]: true }));
      setTimeout(() => setFlash((f) => { const n = { ...f }; delete n[m.item_id]; return n; }), 900);
      setTimeout(step, Math.max(25, Math.min(300, (intervalMs.current * 0.7) / (queue.current.length + 1))));
    };
    step();
  }, []);

  const applyTick = useCallback((r: TickResult | null) => {
    if (!r) return;
    if (r.movements?.length) {
      const asc = [...r.movements].sort((a, b) => a.seq - b.seq);
      if (intervalMs.current < 1000 || asc.length > 30) setFeed((f) => [...asc.reverse(), ...f].slice(0, 400));
      else { queue.current.push(...asc); drain(); }
    }
    if (r.critical?.length && r.paused) setBanner({ kind: "pause", events: r.critical });
  }, [drain]);

  const apply = useCallback((res: { snapshot?: Snapshot; result?: unknown }) => {
    if (res.snapshot) setSnap(res.snapshot);
    if (res.result && typeof res.result === "object" && "movements" in (res.result as object)) applyTick(res.result as TickResult);
  }, [applyTick]);

  // ---- the clock loop: the SERVER owns the clock; the browser only asks for the next hour, naming the hour it expects ----
  useEffect(() => {
    if (!running) return;
    let off = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      const t0 = Date.now();
      try {
        const res = await http<{ snapshot: Snapshot; result: TickResult }>("/api/sim", { action: "tick", expected: tickRef.current, auto: true });
        if (off) return;
        apply(res);
      } catch (e) { setError(String((e as Error).message)); return; }
      timer = setTimeout(loop, Math.max(100, intervalMs.current - (Date.now() - t0)));
    };
    loop();
    return () => { off = true; clearTimeout(timer); };
  }, [running, snap?.sim.interval_ms, apply]);

  const sim = async (body: Record<string, unknown>) => {
    setBusy(true);
    try { apply(await http("/api/sim", body)); } catch (e) { setError(String((e as Error).message)); } finally { setBusy(false); }
  };
  const reset = async () => { queue.current = []; setFeed([]); setShown({}); setFlash({}); setBanner(null); await sim({ action: "reset" }); setMoreLeft(false); };

  const post = useCallback(async (url: string, body: unknown, method = "POST") => {
    setBusy(true);
    try {
      const res = await http<any>(url, body, method);
      if (res && res.snapshot) setSnap(res.snapshot);
      return res;
    } finally { setBusy(false); }
  }, []);
  const decide: AppApi["decide"] = async (id, decision, o) => { try { await post(`/api/recommendations/${id}`, { decision, ...o }); } catch (e) { setError(String((e as Error).message)); } };
  const editQty: AppApi["editQty"] = async (id, qty) => { try { await post(`/api/recommendations/${id}`, { qty }, "PATCH"); } catch (e) { setError(String((e as Error).message)); } };

  const loadMoreFeed = async () => {
    const last = feed[feed.length - 1];
    const more = await http<FeedMove[]>(`/api/movements?before=${last?.seq ?? 0}&limit=${snap?.sim.page_size ?? 60}`);
    setFeed((f) => [...f, ...more]);
    setMoreLeft(more.length >= (snap?.sim.page_size ?? 60));
  };

  // ---- "Run analysis": the five agents one after another, visibly ----
  const analyse = async () => {
    if (analysis.running || !snap) return;
    const group = `manual#${Date.now()}`;
    setAnalysis({ running: true, step: 0 });
    document.getElementById("agents")?.scrollIntoView({ behavior: "smooth", block: "center" });
    try {
      for (let i = 0; i < snap.agent_order.length; i++) {
        setAnalysis({ running: true, step: i });
        await sleep(450);
        const res = await http<{ snapshot: Snapshot }>("/api/agents", { agent: snap.agent_order[i], group });
        setSnap(res.snapshot);
        await sleep(300);
      }
    } catch (e) { setError(String((e as Error).message)); }
    setAnalysis({ running: false, step: 0 });
  };

  const audit = async () => {
    setAuditing(true);
    try {
      const r = await http<{ snapshot: Snapshot; passed: number; total: number; failures: { name: string; detail: string }[] }>("/api/audit", {});
      setSnap(r.snapshot);
      setBanner(r.failures.length ? { kind: "audit", text: r.failures.map((f) => `${f.name}: ${f.detail}`).join(" | ") } : null);
    } catch (e) { setError(String((e as Error).message)); }
    setAuditing(false);
  };

  const api: AppApi | null = useMemo(() => {
    if (!snap) return null;
    return { lang, snap, busy, ...makeApi(lang, snap), decide, editQty, select: setSelected, post: (u, b) => post(u, b) } as AppApi;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, snap, busy, post]);

  if (!snap || !api) return <div className="grid min-h-screen place-items-center text-muted">{error ?? "…"}</div>;
  const { T, R } = api;
  const decided = snap.recs.filter((r) => r.status !== "PENDING").length;

  return (
    <AppCtx.Provider value={api}>
      <div className="min-h-screen">
        <TopBar theme={theme} analysing={analysis.running} auditing={auditing}
          onPlay={() => sim({ action: "play" })} onPause={() => sim({ action: "pause" })} onStep={() => sim({ action: "tick", expected: snap.sim.tick })}
          onAdvance={(o) => sim({ action: "advance", ...o })} onReset={reset} onInterval={(ms) => sim({ action: "interval", ms })}
          onAutoPause={(v) => sim({ action: "auto_pause", value: v })} onLang={() => setLang((l) => (l === "ar" ? "en" : "ar"))}
          onTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} onAnalyse={analyse} onAudit={audit} />

        <main className="mx-auto max-w-[1500px] space-y-4 px-4 py-4">
          {error && <div role="alert" className="flex items-center justify-between rounded-lg border border-crit bg-crit-soft px-3 py-2 text-sm text-crit"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="dismiss">✕</button></div>}
          {banner?.kind === "pause" && (
            <div role="alert" className="rounded-xl border-2 border-crit bg-crit-soft px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-crit">⏸ {T("pausedCritical")}</strong>
                <span className="flex gap-2"><button type="button" onClick={() => { setBanner(null); sim({ action: "play" }); }} className="rounded-lg bg-brand px-3 py-1 text-sm font-semibold text-brand-ink">{T("resume")}</button><button type="button" onClick={() => setBanner(null)} className="rounded-lg border border-line bg-surface px-3 py-1 text-sm font-semibold">{T("dismiss")}</button></span>
              </div>
              <ul className="mt-1 list-disc ps-5 text-sm">{banner.events?.slice(0, 4).map((e) => <li key={e.id}>{R(e.msg)}</li>)}</ul>
            </div>
          )}
          {banner?.kind === "audit" && <div role="alert" className="rounded-xl border-2 border-crit bg-crit-soft px-4 py-3 text-sm text-crit"><strong>{T("health.failed")}</strong> {banner.text}<button type="button" className="ms-3 underline" onClick={() => setBanner(null)}>{T("dismiss")}</button></div>}

          <KpiStrip />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-4"><FeedPanel feed={feed} onMore={loadMoreFeed} moreLeft={moreLeft} /></div>
            <div className="min-w-0 lg:col-span-8"><StockTable flash={flash} shown={shown} /></div>
          </div>
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
            <div className="min-w-0 space-y-4 lg:col-span-5"><PendingPanel /></div>
            <div className="min-w-0 lg:col-span-7"><AlertsPanel /></div>
          </div>
          <SpacePanel />
          <PlanPanel />
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-7"><ImpactPanel version={`${Math.floor(snap.sim.tick / 6)}-${decided}`} /></div>
            <div className="min-w-0 lg:col-span-5"><AgentPanel analysis={analysis} onAnalyse={analyse} /></div>
          </div>
          <ManualPanel />
          <SettingsPanel />
          <footer className="pb-6 text-center text-xs text-muted">{T("footer")}</footer>
        </main>
        {selected && <ItemDrawer itemId={selected} onClose={() => setSelected(null)} />}
      </div>
    </AppCtx.Provider>
  );
}
