"use client";
import type { ReactNode } from "react";
import { tr, type Lang, type Key } from "@/lib/i18n";

export const pick = (lang: Lang, en: string | null | undefined, ar: string | null | undefined) => (lang === "ar" ? ar ?? en ?? "" : en ?? ar ?? "");

const TONE: Record<string, string> = {
  Critical: "bg-crit-soft text-crit", High: "bg-high-soft text-high", Monitor: "bg-mon-soft text-mon", Info: "bg-info-soft text-info",
  Low: "bg-mon-soft text-mon", OK: "bg-ok-soft text-ok", Overstock: "bg-over-soft text-over", Expiring: "bg-high-soft text-high",
  APPROVE: "bg-ok-soft text-ok", REJECT: "bg-crit-soft text-crit", PARTIAL: "bg-mon-soft text-mon",
  FUNDED: "bg-ok-soft text-ok", PARTIALF: "bg-mon-soft text-mon", DEFERRED: "bg-high-soft text-high", OVERSTOCK: "bg-over-soft text-over",
  REJECTEDLINE: "bg-crit-soft text-crit", PENDING: "bg-surface2 text-muted", APPROVED: "bg-ok-soft text-ok", REJECTED: "bg-crit-soft text-crit",
};
export const STRIPE: Record<string, string> = {
  Critical: "border-crit", High: "border-high", Monitor: "border-mon", Info: "border-info",
};

export function Pill({ tone, children, title }: { tone: string; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[tone] ?? "bg-surface2 text-muted"}`}>
      {children}
    </span>
  );
}

export const StatusPill = ({ status, lang }: { status: string; lang: Lang }) => <Pill tone={status}>{tr(lang, status as Key)}</Pill>;

export function CritBadge({ c }: { c: string }) {
  const cls = c === "A" ? "bg-brand text-brand-ink" : c === "B" ? "bg-brand-soft text-brand" : "bg-surface2 text-muted border border-line";
  return <span className={`inline-flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-bold ${cls}`}>{c}</span>;
}

export function Btn({ children, onClick, tone = "ghost", disabled, className = "", title }: {
  children: ReactNode; onClick?: () => void; tone?: "primary" | "ghost" | "ok" | "bad"; disabled?: boolean; className?: string; title?: string;
}) {
  const t = {
    primary: "bg-brand text-brand-ink hover:opacity-90",
    ghost: "bg-surface2 text-ink border border-line hover:border-brand",
    ok: "bg-ok text-white hover:opacity-90",
    bad: "bg-surface text-crit border border-crit hover:bg-crit-soft",
  }[tone];
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${t} ${className}`}>
      {children}
    </button>
  );
}

export function CardHead({ title, sub, right, id }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <div id={id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
      <div>
        <h2 className="text-base font-bold leading-tight">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export const Spinner = () => (
  <span className="spin inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent" aria-hidden />
);

export function ApprovalButtons({ lang, status, busy, onDecide }: { lang: Lang; status: string; busy: boolean; onDecide: (d: "APPROVED" | "REJECTED") => void }) {
  if (status !== "PENDING") return <Pill tone={status}>{status === "APPROVED" ? "✓ " : "✕ "}{tr(lang, status === "APPROVED" ? "approved" : "rejected")}</Pill>;
  return (
    <div className="flex gap-2">
      <Btn tone="ok" disabled={busy} onClick={() => onDecide("APPROVED")}>{tr(lang, "approve")}</Btn>
      <Btn tone="bad" disabled={busy} onClick={() => onDecide("REJECTED")}>{tr(lang, "reject")}</Btn>
    </div>
  );
}
