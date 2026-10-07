"use client";
import { useApp } from "./ctx";
import { ApprovalButtons, CardHead, Pill, QtyEdit } from "./ui";

/** Decisions waiting for the user, with how long they have been waiting (they escalate when left too long). */
export default function PendingPanel() {
  const { snap, T, N, OMR, U, R, name, DT, D } = useApp();
  const pending = snap.recs.filter((r) => r.status === "PENDING").sort((a, b) => b.age_hours - a.age_hours);
  return (
    <section id="pending" className="card scroll-mt-28" aria-label={T("pendingTitle")}>
      <CardHead title={T("pendingTitle")} sub={T("pendingSub")} right={<span className="num rounded-full bg-surface2 px-2.5 py-0.5 text-xs font-semibold">{N(pending.length)}</span>} />
      <ul className="scroll-thin max-h-[360px] divide-y divide-line overflow-y-auto">
        {pending.length === 0 && <li className="p-4 text-center text-sm text-muted">{T("pendingNone")}</li>}
        {pending.map((r) => {
          const p = r.payload;
          return (
            <li key={r.id} className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 ${r.overdue ? "bg-high-soft/50" : ""}`}>
              <div className="min-w-0 flex-1 text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone={r.kind === "PO" ? "Info" : r.kind === "SPACE" ? "OK" : "Monitor"}>{T(`kind.${r.kind}`)}</Pill>
                  {r.source === "manual" && <Pill tone="user">{T("you")}</Pill>}
                  {r.reopen_count > 0 && <Pill tone="High">{T("reopened")}</Pill>}
                  {r.overdue && <Pill tone="Critical">{T("overdue")}</Pill>}
                  <span className="font-semibold">
                    {r.kind === "PO" && name(r.item_id)}
                    {r.kind === "SUPPLIER_MSG" && `${p.supplier_name} · ${name(r.item_id)}`}
                    {r.kind === "SPACE" && `${r.request_id} · ${p.company}`}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {r.kind === "PO" && <>{T("qty")} <span className="num font-semibold text-ink">{N(p.qty)}</span> {U(p.unit)} · {OMR(p.cost)} · {T("poArrives")} <span className="num">{D(p.expected_arrival)}</span>{p.reopen_reason && <> · {T("reopenWhy")}: {R(p.reopen_reason)}</>}</>}
                  {r.kind === "SPACE" && <>{T(`dec.${p.decision}`)} · <span className="num">{N(p.area_m2)}</span> {T("fmt.m2")}</>}
                  {r.kind === "SUPPLIER_MSG" && R(p.subject)}
                  {" · "}{T("pendingFor")} <span className="num font-semibold">{N(r.age_hours)}</span> {T("u.h")} ({T("since")} <span className="num">{DT(r.created_tick)}</span>)
                </div>
              </div>
              <div className="flex items-center gap-2">
                {r.kind === "PO" && <QtyEdit rec={r} />}
                <ApprovalButtons rec={r} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
