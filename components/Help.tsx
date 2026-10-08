"use client";
import { useState } from "react";
import { useApp } from "./ctx";
import { Btn, Modal, Tabs } from "./ui";

export const GLOSSARY = ["lasts", "order_point", "lead", "safety", "overstock", "expiring", "lot", "lease", "rentable", "buffer", "season", "spike", "critical_level", "forecast", "window", "listing", "offer", "counter", "margin"];
const TOUR = [1, 2, 3, 4, 5, 6];
const DEMO = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** First-run tour: 5 short steps, skippable, remembered. */
export function GuideTour({ onDone }: { onDone: () => void }) {
  const { T, N } = useApp();
  const [i, setI] = useState(0);
  const last = i === TOUR.length - 1;
  return (
    <Modal title={T("guide.title")} onClose={onDone}>
      <p className="text-xs font-semibold text-muted">{T("guide.step")} <span className="num">{N(i + 1)}</span> / <span className="num">{N(TOUR.length)}</span></p>
      <h3 className="mt-1 text-lg font-bold">{T(`guide.s${i + 1}.t`)}</h3>
      <p className="mt-2 text-sm leading-relaxed">{T(`guide.s${i + 1}.b`)}</p>
      <div className="mt-5 flex items-center justify-between gap-2">
        <Btn onClick={onDone}>{T("guide.skip")}</Btn>
        <div className="flex gap-2">
          {i > 0 && <Btn onClick={() => setI(i - 1)}>{T("guide.back")}</Btn>}
          <Btn tone="primary" onClick={() => (last ? onDone() : setI(i + 1))}>{last ? T("guide.done") : T("guide.next")}</Btn>
        </div>
      </div>
    </Modal>
  );
}

/** Help: quick tour, the 2-minute demo script, and the glossary. */
export function HelpModal({ onClose, onTour }: { onClose: () => void; onTour: () => void }) {
  const { T } = useApp();
  const [tab, setTab] = useState("demo");
  return (
    <Modal title={T("help.title")} onClose={onClose} wide>
      <Tabs label={T("help.title")} value={tab} onChange={setTab} tabs={[{ id: "demo", label: T("help.demo") }, { id: "gloss", label: T("help.glossary") }, { id: "tour", label: T("help.tour") }]} />
      <div className="pt-4" role="tabpanel">
        {tab === "demo" && (<>
          <p className="mb-2 text-sm text-muted">{T("demo.intro")}</p>
          <ol className="list-decimal space-y-2 ps-5 text-sm leading-relaxed">{DEMO.map((n) => <li key={n}>{T(`demo.s${n}`)}</li>)}</ol>
        </>)}
        {tab === "gloss" && <dl className="space-y-3 text-sm">{GLOSSARY.map((k) => <div key={k}><dt className="font-bold">{T(`gl.${k}.term`)}</dt><dd className="text-muted">{T(`gl.${k}.def`)}</dd></div>)}</dl>}
        {tab === "tour" && (<><p className="mb-3 text-sm text-muted">{T("help.tour_text")}</p><Btn tone="primary" onClick={onTour}>{T("help.tour_start")}</Btn></>)}
      </div>
    </Modal>
  );
}
