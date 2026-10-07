"use client";
import { useState, type ReactNode } from "react";
import type { Explain } from "@/lib/calc";
import { useApp } from "./ctx";

const TONE: Record<string, string> = {
  Critical: "bg-crit-soft text-crit", High: "bg-high-soft text-high", Monitor: "bg-mon-soft text-mon", Info: "bg-info-soft text-info",
  Low: "bg-mon-soft text-mon", OK: "bg-ok-soft text-ok", Overstock: "bg-over-soft text-over", Expiring: "bg-high-soft text-high",
  APPROVE: "bg-ok-soft text-ok", REJECT: "bg-crit-soft text-crit", PARTIAL: "bg-mon-soft text-mon",
  FUNDED: "bg-ok-soft text-ok", PARTIALF: "bg-mon-soft text-mon", DEFERRED: "bg-high-soft text-high", OVERSTOCK: "bg-over-soft text-over",
  REJECTEDLINE: "bg-crit-soft text-crit", PENDING: "bg-surface2 text-muted", APPROVED: "bg-ok-soft text-ok", REJECTED: "bg-crit-soft text-crit",
  ACTIVE: "bg-ok-soft text-ok", RESERVED: "bg-info-soft text-info", ENDED: "bg-surface2 text-muted", user: "bg-brand-soft text-brand",
};
export const STRIPE: Record<string, string> = { Critical: "border-crit", High: "border-high", Monitor: "border-mon", Info: "border-info" };

export function Pill({ tone, children, title }: { tone: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[tone] ?? "bg-surface2 text-muted"}`}>{children}</span>
  );
}
export function StatusPill({ status }: { status: string }) { const { T } = useApp(); return <Pill tone={status}>{T(`st.${status}`)}</Pill>; }
export function SevPill({ sev }: { sev: string }) { const { T } = useApp(); return <Pill tone={sev}>{T(`sev.${sev}`)}</Pill>; }

export function CritBadge({ c, rank }: { c: string; rank: number }) {
  const cls = rank === 0 ? "bg-brand text-brand-ink" : rank === 1 ? "bg-brand-soft text-brand" : "bg-surface2 text-muted border border-line";
  return <span className={`inline-flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-bold ${cls}`}>{c}</span>;
}

export function Btn({ children, onClick, tone = "ghost", disabled, className = "", title, type = "button" }: {
  children: ReactNode; onClick?: () => void; tone?: "primary" | "ghost" | "ok" | "bad"; disabled?: boolean; className?: string; title?: string; type?: "button" | "submit";
}) {
  const t = { primary: "bg-brand text-brand-ink hover:opacity-90", ghost: "bg-surface2 text-ink border border-line hover:border-brand",
    ok: "bg-ok text-white hover:opacity-90", bad: "bg-surface text-crit border border-crit hover:bg-crit-soft" }[tone];
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${t} ${className}`}>
      {children}
    </button>
  );
}

export function CardHead({ title, sub, right, id }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <div id={id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
      <div><h2 className="text-base font-bold leading-tight">{title}</h2>{sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}</div>
      {right}
    </div>
  );
}
export const Spinner = () => <span className="spin inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent" aria-hidden />;

/** "How is this calculated": formula, the actual inputs with units and sources, and the result. */
export function ExplainBtn({ e }: { e: Explain | null | undefined }) {
  const { T, N, U } = useApp();
  const [open, setOpen] = useState(false);
  if (!e) return null;
  const unitText = (u?: string) => (!u ? "" : " " + (u === "wk" ? T("u.wk") : u === "m²" ? T("fmt.m2") : u === "OMR" ? T("fmt.omr") : U(u)));
  const val = (v: number | string, unit?: string) =>
    typeof v === "number" ? `${N(v, Number.isInteger(v) ? 0 : Math.abs(v) < 10 ? 2 : 1)}${unitText(unit)}` : `${v}${unitText(unit)}`;
  const res = e.result.value;
  const resText = typeof res === "string" && T(`st.${res}`) !== `st.${res}` ? T(`st.${res}`) : typeof res === "string" && T(`ex.res.${res}`) !== `ex.res.${res}` ? T(`ex.res.${res}`) : val(res, e.result.unit);
  return (
    <span className="relative inline-block align-middle">
      <button type="button" aria-expanded={open} aria-label={T("ex.how")} title={T("ex.how")} onClick={(ev) => { ev.stopPropagation(); setOpen((o) => !o); }}
        className="ms-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-line bg-surface2 text-[10px] font-bold text-muted hover:border-brand hover:text-brand">i</button>
      {open && (
        <span role="dialog" onClick={(ev) => ev.stopPropagation()} className="absolute start-0 top-6 z-40 block w-72 rounded-xl border border-line bg-surface p-3 text-start text-xs font-normal text-ink shadow-xl">
          <span className="mb-1 block font-bold">{T("ex.how")}</span>
          <span className="mb-2 block rounded-md bg-surface2 px-2 py-1 text-[11px]">{T(e.formula)}</span>
          {e.inputs.map((i, k) => (
            <span key={k} className="flex justify-between gap-2 border-t border-line py-1">
              <span>{T(i.label)}{i.source && <span className="block text-[10px] text-muted">{i.source}</span>}</span>
              <span className="num font-semibold">{val(i.value, i.unit)}</span>
            </span>
          ))}
          <span className="mt-1 flex justify-between gap-2 border-t-2 border-line pt-1.5 font-bold"><span>{T("ex.result")}</span><span className="num">{resText}</span></span>
          <button type="button" onClick={() => setOpen(false)} className="mt-2 text-[11px] text-brand hover:underline">{T("close")}</button>
        </span>
      )}
    </span>
  );
}

export function ApprovalButtons({ rec }: { rec: { id: number; status: string } }) {
  const { T, decide, busy } = useApp();
  if (rec.status !== "PENDING") return <Pill tone={rec.status}>{rec.status === "APPROVED" ? "✓ " : "✕ "}{T(rec.status === "APPROVED" ? "approved" : "rejected")}</Pill>;
  return (
    <div className="flex gap-2">
      <Btn tone="ok" disabled={busy} onClick={() => decide(rec.id, "APPROVED")}>{T("approve")}</Btn>
      <Btn tone="bad" disabled={busy} onClick={() => decide(rec.id, "REJECTED")}>{T("reject")}</Btn>
    </div>
  );
}

/** Quantity of a PO draft, editable before approving. */
export function QtyEdit({ rec }: { rec: { id: number; status: string; payload: any } }) {
  const { editQty, busy, N } = useApp();
  const [v, setV] = useState<string>("");
  if (rec.status !== "PENDING") return <span className="num font-semibold">{N(rec.payload.qty)}</span>;
  return (
    <input aria-label="qty" type="number" min={1} disabled={busy} value={v === "" ? rec.payload.qty : v} onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== "" && Number(v) !== rec.payload.qty && Number(v) >= 1) editQty(rec.id, Number(v)).then(() => setV("")); else setV(""); }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="num w-24 rounded-md border border-line bg-surface px-2 py-1 text-sm font-semibold focus:border-brand focus:outline-none" />
  );
}
