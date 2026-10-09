"use client";
import { useEffect, useState } from "react";
import { useSnap } from "@/lib/store";
import { useApp } from "./ctx";
import { Btn } from "./ui";
import { GUIDE_STEPS, guideDone } from "@/lib/guide";

/**
 * Guided demo: six steps over the real screens (stock risk -> purchase decision -> free space -> listing -> offer -> rental income).
 * A small panel in a corner, never a modal: the screen stays usable, it can be minimised or closed, and each step is ticked when it
 * really happened (read from the snapshot), so the guide follows the person instead of the other way round.
 */
const STEPS = GUIDE_STEPS;

const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window */ } } };

export default function DemoGuide({ onClose }: { onClose: () => void }) {
  const { T, N, setSection } = useApp();
  const [i, setI] = useState(() => Math.min(STEPS.length - 1, Math.max(0, Number(store.get("ss-demo-step")) || 0)));
  const [small, setSmall] = useState(() => typeof window !== "undefined" && window.innerWidth < 640); // on a phone it starts as a small pill
  useEffect(() => { store.set("ss-demo-step", String(i)); }, [i]);

  // what has really happened (lib/guide.ts)
  const flags = useSnap((s) => guideDone(s).join(",")) ?? ""; // a string, so the panel re-renders only when a step flips
  const done = flags.split(",").map((x) => x === "true");
  const step = STEPS[i];

  const show = () => {
    setSection(step.section);
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(step.target);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("guide-flash"); void el.offsetWidth; el.classList.add("guide-flash"); // restart the highlight
      setTimeout(() => el.classList.remove("guide-flash"), 2600);
    }, 60);
  };

  if (small) {
    return (
      <button type="button" onClick={() => setSmall(false)} className="fixed bottom-4 end-4 z-40 min-h-12 rounded-full border border-brand bg-surface px-4 text-sm font-semibold text-brand shadow-lg">
        ▸ {T("demo.guide.title")} · <span className="num">{N(i + 1)}/{N(STEPS.length)}</span>
      </button>
    );
  }
  return (
    <aside aria-label={T("demo.guide.title")} className="fixed bottom-4 end-4 z-40 w-[min(380px,calc(100vw-2rem))] rounded-xl border-2 border-brand bg-surface p-3.5 shadow-xl">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-sm">{T("demo.guide.title")}</strong>
        <span className="flex items-center">
          <button type="button" onClick={() => setSmall(true)} aria-label={T("demo.guide.minimise")} title={T("demo.guide.minimise")} className="min-h-10 min-w-10 text-muted hover:text-ink">▾</button>
          <button type="button" onClick={onClose} aria-label={T("guide.skip")} title={T("guide.skip")} className="min-h-10 min-w-10 text-muted hover:text-ink">✕</button>
        </span>
      </div>
      <ol className="mt-1 flex gap-1" aria-hidden>
        {STEPS.map((s, k) => <li key={s.id} className={`h-1.5 flex-1 rounded-full ${done[k] ? "bg-ok" : k === i ? "bg-brand" : "bg-line"}`} />)}
      </ol>
      <p className="mt-2 text-xs font-semibold text-muted">{T("guide.step")} <span className="num">{N(i + 1)}</span> / <span className="num">{N(STEPS.length)}</span>{done[i] && <span className="ms-2 text-ok">✓ {T("demo.guide.done")}</span>}</p>
      <h3 className="mt-0.5 text-base font-bold leading-snug">{T(`demo.guide.${step.id}.t`)}</h3>
      <p className="mt-1 text-sm leading-relaxed">{T(`demo.guide.${step.id}.b`)}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Btn onClick={show}>◎ {T("demo.guide.show")}</Btn>
        <span className="flex gap-2">
          {i > 0 && <Btn onClick={() => setI(i - 1)}>{T("guide.back")}</Btn>}
          {i < STEPS.length - 1 ? <Btn tone={done[i] ? "primary" : "ghost"} onClick={() => setI(i + 1)}>{T("guide.next")}</Btn> : <Btn tone="primary" onClick={onClose}>{T("guide.done")}</Btn>}
        </span>
      </div>
    </aside>
  );
}
