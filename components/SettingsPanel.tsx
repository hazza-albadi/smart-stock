"use client";
import { useEffect, useState } from "react";
import { useSnap } from "@/lib/store";
import { useApp, useBusy } from "./ctx";
import { Btn, Spinner } from "./ui";

interface Row { key: string; value: unknown; unit: string; description: string }

/** Data check (are the numbers consistent?) and the settings of the simulation. */
export default function SettingsPanel({ auditing, onAudit }: { auditing: boolean; onAudit: () => void }) {
  const { T, N, post } = useApp();
  const busy = useBusy();
  const health = useSnap((s) => s.health);
  const [rows, setRows] = useState<Row[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open && !rows.length) fetch("/api/settings").then((r) => r.json()).then(setRows).catch(() => setErr(T("err.load"))); }, [open, rows.length, T]);
  const save = async (r: Row) => {
    const txt = draft[r.key];
    if (txt === undefined || txt === JSON.stringify(r.value)) return;
    try { setRows(await post("/api/settings", { key: r.key, value: JSON.parse(txt) })); setErr(null); setDraft((d) => { const n = { ...d }; delete n[r.key]; return n; }); }
    catch (e) { setErr(`${r.key}: ${(e as Error).message}`); }
  };
  return (
    <div className="scroll-thin max-h-[560px] overflow-y-auto p-4">
      <h3 className="text-sm font-bold">{T("health.title")}</h3>
      <p className="mt-1 text-sm text-muted">{T("health.sub")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Btn onClick={onAudit} disabled={auditing || busy}>{auditing ? <Spinner /> : "✓"} {T("health.run")}</Btn>
        <span className={`text-sm font-semibold ${health ? (health.passed === health.total ? "text-ok" : "text-crit") : "text-muted"}`}>
          {health ? `${health.passed === health.total ? "✓" : "⚠"} ${T("health.result")}: ` : T("health.never")}
          {health && <span className="num">{N(health.passed)}/{N(health.total)}</span>}
        </span>
      </div>
      <h3 className="mt-6 text-sm font-bold">{T("settings.title")}</h3>
      <p className="mt-1 text-sm text-muted">{T("settings.sub")}</p>
      <Btn className="mt-2" onClick={() => setOpen((o) => !o)}>{open ? T("hide") : T("show")}</Btn>
      {open && (
        <div className="mt-3 overflow-x-auto rounded-lg border border-line">
          {err && <p role="alert" className="m-3 rounded-md bg-crit-soft px-3 py-2 text-sm text-crit">{err}</p>}
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead className="bg-surface2 text-xs text-muted"><tr><th className="px-3 py-2 text-start">{T("settings.key")}</th><th className="px-3 py-2 text-start">{T("settings.value")}</th><th className="px-3 py-2 text-start">{T("settings.desc")}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-line align-top">
                  <td className="num px-3 py-2 text-xs font-semibold">{r.key}</td>
                  <td className="px-3 py-2"><input aria-label={r.key} dir="ltr" className="num min-h-10 w-52 rounded-md border border-line bg-surface px-2 text-xs" value={draft[r.key] ?? JSON.stringify(r.value)} onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))} onBlur={() => save(r)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} /></td>
                  <td className="px-3 py-2 text-xs text-muted">{r.description} <span className="num">({r.unit})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
