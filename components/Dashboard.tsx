"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Snapshot } from "@/lib/snapshot";
import type { Lang } from "@/lib/i18n";
import TopBar from "./TopBar";
import KpiStrip from "./KpiStrip";
import FeedPanel, { type FeedMove } from "./FeedPanel";
import StockTable from "./StockTable";
import AlertsPanel from "./AlertsPanel";
import AgentPanel, { type Analysis } from "./AgentPanel";
import SpacePanel from "./SpacePanel";
import PlanPanel from "./PlanPanel";
import ItemDrawer from "./ItemDrawer";
import { pick } from "./ui";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FEED_MAX = 120;

async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

interface TickEvent { id: number; severity: string; type: string; message_ar: string; message_en: string }
interface Toast { id: number; sev: string; ar: string; en: string }

export default function Dashboard() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [lang, setLang] = useState<Lang>("ar");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [feed, setFeed] = useState<FeedMove[]>([]);
  const [flash, setFlash] = useState<Record<string, boolean>>({});
  const [shown, setShown] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis>({ running: false, step: 0 });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [error, setError] = useState<string | null>(null);

  const queue = useRef<FeedMove[]>([]);
  const draining = useRef(false);
  const intervalMs = useRef(3000);
  const running = snap?.sim.running ?? false;
  const speed = snap?.sim.speed ?? 1;
  const tickSeconds = snap?.sim.tick_seconds ?? 3;
  intervalMs.current = (tickSeconds * 1000) / speed;

  // ---- language / theme (persisted) ----
  useEffect(() => {
    try {
      const l = localStorage.getItem("ss-lang") as Lang | null;
      if (l === "ar" || l === "en") setLang(l);
      setTheme((document.documentElement.getAttribute("data-theme") as "light" | "dark") || "light");
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    try { localStorage.setItem("ss-lang", lang); } catch { /* ignore */ }
  }, [lang]);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("ss-theme", theme); } catch { /* ignore */ }
  }, [theme]);

  const refresh = useCallback(async () => setSnap(await api<Snapshot>("/api/state")), []);
  useEffect(() => { refresh().catch((e) => setError(String(e))); }, [refresh]);

  // ---- staggered reveal of movements: rows appear one after another with a flash on the stock row ----
  const drain = useCallback(() => {
    if (draining.current) return;
    draining.current = true;
    const step = () => {
      const m = queue.current.shift();
      if (!m) {
        draining.current = false;
        setShown({});
        return;
      }
      setFeed((f) => [m, ...f].slice(0, FEED_MAX));
      setShown((s) => ({ ...s, [m.item_id]: m.balance_after }));
      setFlash((f) => ({ ...f, [m.item_id]: true }));
      setTimeout(() => setFlash((f) => { const n = { ...f }; delete n[m.item_id]; return n; }), 1000);
      const n = queue.current.length;
      setTimeout(step, Math.max(35, Math.min(420, (intervalMs.current * 0.8) / (n + 1))));
    };
    step();
  }, []);

  const pushToasts = useCallback((events: TickEvent[]) => {
    const important = events.filter((e) => e.severity === "critical" || (e.severity === "high" && e.type !== "ALERT")).slice(0, 3);
    if (!important.length) return;
    const add = important.map((e) => ({ id: e.id, sev: e.severity, ar: e.message_ar, en: e.message_en }));
    setToasts((t) => [...add, ...t].slice(0, 4));
    for (const a of add) setTimeout(() => setToasts((t) => t.filter((x) => x.id !== a.id)), 7000);
  }, []);

  const applyTick = useCallback((res: { tick: { movements: FeedMove[]; events: TickEvent[] } | null; snapshot: Snapshot }) => {
    setSnap(res.snapshot);
    if (res.tick) {
      queue.current.push(...res.tick.movements);
      drain();
      pushToasts(res.tick.events);
    }
  }, [drain, pushToasts]);

  // ---- the simulation loop: one POST /api/sim {tick} per simulated day while running ----
  useEffect(() => {
    if (!running) return;
    let off = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      const t0 = Date.now();
      try {
        const res = await api<{ tick: never; snapshot: Snapshot }>("/api/sim", { action: "tick" });
        if (off) return;
        applyTick(res);
      } catch (e) { setError(String(e)); return; }
      timer = setTimeout(loop, Math.max(150, intervalMs.current - (Date.now() - t0)));
    };
    loop();
    return () => { off = true; clearTimeout(timer); };
  }, [running, applyTick]);

  const sim = async (body: { action: string; speed?: number }) => {
    setBusy(true);
    try { applyTick(await api("/api/sim", body)); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  const reset = async () => {
    queue.current = [];
    setFeed([]); setShown({}); setFlash({}); setToasts([]);
    await sim({ action: "reset" });
  };

  const decide = async (id: number, decision: "APPROVED" | "REJECTED") => {
    setBusy(true);
    try { setSnap((await api<{ snapshot: Snapshot }>(`/api/recommendations/${id}`, { decision })).snapshot); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };

  // ---- "Run analysis": the five agents one after another, visibly ----
  const analyse = async () => {
    if (analysis.running) return;
    const group = `manual#${Date.now()}`;
    setAnalysis({ running: true, step: 0 });
    document.getElementById("agents")?.scrollIntoView({ behavior: "smooth", block: "center" });
    try {
      const order = snap?.agent_order ?? ["forecast", "replenishment", "space", "alerts", "matching"];
      for (let i = 0; i < order.length; i++) {
        setAnalysis({ running: true, step: i });
        await sleep(450);
        const res = await api<{ snapshot: Snapshot }>("/api/agents", { agent: order[i], group });
        setSnap(res.snapshot);
        await sleep(350);
      }
    } catch (e) { setError(String(e)); }
    setAnalysis({ running: false, step: 0 });
  };

  if (!snap) return <div className="grid min-h-screen place-items-center text-muted">{error ?? "…"}</div>;

  return (
    <div className="min-h-screen">
      <TopBar lang={lang} theme={theme} date={snap.sim.date} running={running} speed={speed} busy={busy} analysing={analysis.running}
        onPlay={() => sim({ action: "play" })} onPause={() => sim({ action: "pause" })} onStep={() => sim({ action: "tick" })}
        onReset={reset} onSpeed={(s) => sim({ action: "speed", speed: s })}
        onLang={() => setLang((l) => (l === "ar" ? "en" : "ar"))} onTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        onAnalyse={analyse} />

      <main className="mx-auto max-w-[1500px] space-y-4 px-4 py-4">
        {error && (
          <div role="alert" className="flex items-center justify-between rounded-lg border border-crit bg-crit-soft px-3 py-2 text-sm text-crit">
            <span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="dismiss">✕</button>
          </div>
        )}
        <KpiStrip lang={lang} snap={snap} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-4"><FeedPanel lang={lang} feed={feed} events={snap.events} running={running} /></div>
          <div className="min-w-0 lg:col-span-8"><StockTable lang={lang} snap={snap} flash={flash} shown={shown} onSelect={setSelected} /></div>
        </div>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-7"><AlertsPanel lang={lang} snap={snap} busy={busy} onDecide={decide} onSelect={setSelected} /></div>
          <div className="min-w-0 lg:col-span-5"><AgentPanel lang={lang} snap={snap} analysis={analysis} onAnalyse={analyse} /></div>
        </div>

        <SpacePanel lang={lang} snap={snap} busy={busy} onDecide={decide} />
        <PlanPanel lang={lang} snap={snap} busy={busy} onDecide={decide} onSelect={setSelected} />
        <footer className="pb-6 text-center text-xs text-muted">SmartStock · Qeshour · synthetic data · OMR · m²</footer>
      </main>

      {selected && <ItemDrawer lang={lang} itemId={selected} snap={snap} onClose={() => setSelected(null)} />}

      <div className="pointer-events-none fixed bottom-4 start-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`feed-row pointer-events-auto rounded-xl border border-s-4 bg-surface px-3 py-2 text-sm shadow-lg ${t.sev === "critical" ? "border-crit" : "border-high"}`}>
            {pick(lang, t.en, t.ar)}
          </div>
        ))}
      </div>
    </div>
  );
}
