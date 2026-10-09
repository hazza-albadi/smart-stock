"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Explain } from "@/lib/calc";
import { useApp, useBusy } from "./ctx";

/** One status colour system for the whole app: colour + icon + label (never colour alone). */
const TONE: Record<string, string> = {
  Critical: "bg-crit-soft text-crit", High: "bg-high-soft text-high", Monitor: "bg-mon-soft text-mon", Info: "bg-info-soft text-info",
  Low: "bg-mon-soft text-mon", OK: "bg-ok-soft text-ok", Overstock: "bg-over-soft text-over", Expiring: "bg-high-soft text-high",
  APPROVE: "bg-ok-soft text-ok", REJECT: "bg-crit-soft text-crit", PARTIAL: "bg-mon-soft text-mon",
  FUNDED: "bg-ok-soft text-ok", PARTIALF: "bg-mon-soft text-mon", DEFERRED: "bg-high-soft text-high", OVERSTOCK: "bg-over-soft text-over",
  REJECTEDLINE: "bg-crit-soft text-crit", PENDING: "bg-surface2 text-muted", APPROVED: "bg-ok-soft text-ok", REJECTED: "bg-crit-soft text-crit",
  ACTIVE: "bg-ok-soft text-ok", RESERVED: "bg-info-soft text-info", ENDED: "bg-surface2 text-muted", user: "bg-brand-soft text-brand",
};
const ICON: Record<string, string> = {
  Critical: "⛔", High: "▲", Monitor: "◔", Info: "ℹ", Low: "▼", OK: "✓", Overstock: "▣", Expiring: "⏳",
  APPROVE: "✓", REJECT: "✕", PARTIAL: "◐", FUNDED: "✓", PARTIALF: "◐", DEFERRED: "⏸", OVERSTOCK: "▣", REJECTEDLINE: "✕",
  APPROVED: "✓", REJECTED: "✕", ACTIVE: "●", RESERVED: "◷", ENDED: "○",
};
export const STRIPE: Record<string, string> = { Critical: "border-crit", High: "border-high", Monitor: "border-mon", Info: "border-info" };

export function Pill({ tone, children, title, icon = true }: { tone: string; children: ReactNode; title?: string; icon?: boolean }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[tone] ?? "bg-surface2 text-muted"}`}>
      {icon && ICON[tone] && <span aria-hidden>{ICON[tone]}</span>}{children}
    </span>
  );
}
/** Which agent proposed (found, checked) this; opens the agent log, where its READ / REASON / ACT / VERIFY stages are. */
export function AgentBy({ agent, k = "dc.by" }: { agent: string; k?: "dc.by" | "dc.found_by" | "dc.checked_by" }) {
  const { T, R, goTab } = useApp();
  return (
    <button type="button" onClick={() => goTab("agents")} title={T("dc.by_hint")} className="min-h-10 rounded-full px-1.5 text-xs font-semibold text-brand hover:underline">
      <span aria-hidden>⚙ </span>{R({ k, v: { agent: { k: `agent.${agent}` } } })}
    </button>
  );
}
export function StatusPill({ status }: { status: string }) { const { T } = useApp(); return <Pill tone={status}>{T(`st.${status}`)}</Pill>; }
export function SevPill({ sev }: { sev: string }) { const { T } = useApp(); return <Pill tone={sev}>{T(`sev.${sev}`)}</Pill>; }

export function Btn({ children, onClick, tone = "ghost", disabled, className = "", title, type = "button", ariaLabel, size = "md" }: {
  children: ReactNode; onClick?: () => void; tone?: "primary" | "ghost" | "ok" | "bad"; disabled?: boolean; className?: string; title?: string;
  type?: "button" | "submit"; ariaLabel?: string; size?: "md" | "lg";
}) {
  const t = { primary: "bg-brand text-brand-ink hover:opacity-90", ghost: "bg-surface2 text-ink border border-line hover:border-brand",
    ok: "bg-ok text-on-accent hover:opacity-90", bad: "bg-surface text-crit border border-crit hover:bg-crit-soft" }[tone];
  return (
    <button type={type} title={title} aria-label={ariaLabel} disabled={disabled} onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${size === "lg" ? "min-h-12" : "min-h-10"} ${t} ${className}`}>
      {children}
    </button>
  );
}

export function CardHead({ title, sub, right, id }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <div id={id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
      <div className="min-w-0"><h2 className="text-base font-bold leading-tight">{title}</h2>{sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}</div>
      {right}
    </div>
  );
}
export const Spinner = () => <span className="spin inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent" aria-hidden />;

/** Skeleton block: reserves the space of content that is still loading. */
export const Skeleton = ({ h = 16, w = "100%" }: { h?: number; w?: number | string }) => <div className="skeleton rounded-md" style={{ height: h, width: w }} aria-hidden />;

export function Empty({ icon = "✓", title, text }: { icon?: string; title: string; text?: string }) {
  return (
    <div className="flex h-full min-h-[120px] flex-col items-center justify-center gap-1 p-6 text-center">
      <div className="text-2xl text-muted" aria-hidden>{icon}</div>
      <div className="text-sm font-semibold">{title}</div>
      {text && <div className="max-w-sm text-xs text-muted">{text}</div>}
    </div>
  );
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return { open, setOpen, ref };
}

/** "How is this calculated": formula, the actual inputs with units and sources, and the result. */
export function ExplainBtn({ e }: { e: Explain | null | undefined }) {
  const { T, N, U } = useApp();
  const { open, setOpen, ref } = usePopover();
  if (!e) return null;
  const unitText = (u?: string) => (!u ? "" : " " + (u === "wk" ? T("u.wk") : u === "m²" ? T("fmt.m2") : u === "OMR" ? T("fmt.omr") : U(u)));
  const val = (v: number | string, unit?: string) =>
    typeof v === "number" ? `${N(v, Number.isInteger(v) ? 0 : Math.abs(v) < 10 ? 2 : 1)}${unitText(unit)}` : `${v}${unitText(unit)}`;
  const res = e.result.value;
  const resText = typeof res === "string" && T(`st.${res}`) !== `st.${res}` ? T(`st.${res}`) : typeof res === "string" && T(`ex.res.${res}`) !== `ex.res.${res}` ? T(`ex.res.${res}`) : val(res, e.result.unit);
  return (
    <span ref={ref} className="relative inline-block align-middle">
      <button type="button" aria-expanded={open} aria-label={T("ex.how")} title={T("ex.how")} onClick={(ev) => { ev.stopPropagation(); setOpen(!open); }}
        className="icon-btn ms-1">i</button>
      {open && (
        <span role="dialog" aria-label={T("ex.how")} onClick={(ev) => ev.stopPropagation()} className="popover absolute start-0 top-8 z-40 block w-72 max-w-[80vw] rounded-xl border border-line bg-surface p-3 text-start text-xs font-normal text-ink shadow-xl">
          <span className="mb-1 block text-sm font-bold">{T("ex.how")}</span>
          <span className="mb-2 block rounded-md bg-surface2 px-2 py-1">{T(e.formula)}</span>
          {e.inputs.map((i, k) => (
            <span key={k} className="flex justify-between gap-2 border-t border-line py-1">
              <span>{T(i.label)}</span>
              <span className="num font-semibold">{val(i.value, i.unit)}</span>
            </span>
          ))}
          <span className="mt-1 flex justify-between gap-2 border-t-2 border-line pt-1.5 font-bold"><span>{T("ex.result")}</span><span className="num">{resText}</span></span>
        </span>
      )}
    </span>
  );
}

/** A technical word with a one-sentence definition behind a small info button. */
export function Term({ k, children }: { k: string; children: ReactNode }) {
  const { T } = useApp();
  const { open, setOpen, ref } = usePopover();
  return (
    <span ref={ref} className="relative inline-flex items-center">
      {children}
      <button type="button" aria-expanded={open} aria-label={`${T("gl.what")}: ${T(`gl.${k}.term`)}`} onClick={(e) => { e.stopPropagation(); setOpen(!open); }} className="icon-btn ms-1">?</button>
      {open && (
        <span role="tooltip" className="popover absolute start-0 top-8 z-40 block w-64 max-w-[80vw] rounded-xl border border-line bg-surface p-3 text-start text-xs font-normal normal-case text-ink shadow-xl">
          <span className="mb-0.5 block font-bold">{T(`gl.${k}.term`)}</span>{T(`gl.${k}.def`)}
        </span>
      )}
    </span>
  );
}

export function Modal({ title, onClose, children, wide, xl }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; xl?: boolean }) {
  const { T } = useApp();
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={`relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl ${xl ? "sm:max-w-5xl" : wide ? "sm:max-w-2xl" : "sm:max-w-md"}`}>
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-base font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label={T("close")} className="min-h-10 min-w-10 rounded-lg border border-line text-lg hover:border-brand">✕</button>
        </div>
        <div className="scroll-thin overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange, label }: { tabs: { id: string; label: string; badge?: string }[]; value: string; onChange: (id: string) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="scroll-thin flex gap-1 overflow-x-auto border-b border-line px-2">
      {tabs.map((t) => (
        <button key={t.id} role="tab" type="button" id={`tab-${t.id}`} aria-selected={value === t.id} aria-controls={`panel-${t.id}`} onClick={() => onChange(t.id)}
          className={`min-h-11 whitespace-nowrap border-b-2 px-3 text-sm font-semibold ${value === t.id ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"}`}>
          {t.label}{t.badge && <span className="num ms-1.5 rounded-full bg-surface2 px-1.5 text-xs">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

/** Quantity of a PO draft, editable before approving. */
export function QtyEdit({ rec }: { rec: { id: number; status: string; payload: any } }) {
  const { editQty, T } = useApp();
  const busy = useBusy();
  const [v, setV] = useState<string>("");
  if (rec.status !== "PENDING") return null;
  return (
    <input aria-label={T("dc.change_qty")} type="number" min={1} disabled={busy} value={v === "" ? rec.payload.qty : v} onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== "" && Number(v) !== rec.payload.qty && Number(v) >= 1) editQty(rec.id, Number(v)).then(() => setV("")); else setV(""); }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="num min-h-10 w-28 rounded-md border border-line bg-surface px-2 text-sm font-semibold" />
  );
}
