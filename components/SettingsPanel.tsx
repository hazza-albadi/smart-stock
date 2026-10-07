"use client";
import { useEffect, useState } from "react";
import { useApp } from "./ctx";
import { CardHead } from "./ui";

interface Row { key: string; value: unknown; unit: string; description: string }

/** Settings screen: every threshold, rate, schedule and profile of the simulation (seeded from config/defaults.json). */
export default function SettingsPanel() {
  const { T, post } = useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open && !rows.length) fetch("/api/settings").then((r) => r.json()).then(setRows).catch(() => {}); }, [open, rows.length]);
  const save = async (r: Row) => {
    const txt = draft[r.key];
    if (txt === undefined || txt === JSON.stringify(r.value)) return;
    try { setRows(await post("/api/settings", { key: r.key, value: JSON.parse(txt) })); setErr(null); setDraft((d) => { const n = { ...d }; delete n[r.key]; return n; }); }
    catch (e) { setErr(`${r.key}: ${(e as Error).message}`); }
  };
  return (
    <section id="settings" className="card scroll-mt-28" aria-label={T("settingsTitle")}>
      <CardHead title={T("settingsTitle")} sub={T("settingsSub")} right={<button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="rounded-lg border border-line bg-surface2 px-3 py-1.5 text-sm font-semibold hover:border-brand">{open ? T("hide") : T("show")}</button>} />
      {open && (
        <div className="scroll-thin max-h-[520px] overflow-auto">
          {err && <p role="alert" className="m-3 rounded-md bg-crit-soft px-3 py-2 text-sm text-crit">{err}</p>}
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead className="sticky top-0 bg-surface2 text-xs text-muted"><tr><th className="px-3 py-2 text-start">{T("settings.key")}</th><th className="px-3 py-2 text-start">{T("settings.value")}</th><th className="px-3 py-2 text-start">{T("settings.unit")}</th><th className="px-3 py-2 text-start">{T("settings.desc")}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-line align-top">
                  <td className="num px-3 py-2 text-xs font-semibold">{r.key}</td>
                  <td className="px-3 py-2"><input aria-label={r.key} dir="ltr" className="num w-56 rounded-md border border-line bg-surface px-2 py-1 text-xs focus:border-brand focus:outline-none" value={draft[r.key] ?? JSON.stringify(r.value)} onChange={(e) => setDraft((d) => ({ ...d, [r.key]: e.target.value }))} onBlur={() => save(r)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} /></td>
                  <td className="px-3 py-2 text-xs text-muted">{r.unit}</td>
                  <td className="px-3 py-2 text-xs text-muted">{r.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
