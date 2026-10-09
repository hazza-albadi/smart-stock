"use client";
import { useState } from "react";
import { useApp } from "./ctx";
import { Btn, Modal, Tabs } from "./ui";
import HowAgentsWork from "./HowAgentsWork";
import SummaryCard from "./SummaryCard";

export const GLOSSARY = ["lasts", "order_point", "lead", "safety", "overstock", "expiring", "lot", "lease", "rentable", "buffer", "season", "spike", "critical_level", "forecast", "window", "listing", "offer", "counter", "margin", "agent", "stages", "verify", "draft", "summary"];
const DEMO = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

/** Help: quick tour, the 2-minute demo script, and the glossary. */
export function HelpModal({ onClose, onTour }: { onClose: () => void; onTour: () => void }) {
  const { T } = useApp();
  const [tab, setTab] = useState("demo");
  return (
    <Modal title={T("help.title")} onClose={onClose} wide={tab !== "howagents"} xl={tab === "howagents"}>
      <Tabs label={T("help.title")} value={tab} onChange={setTab} tabs={[{ id: "demo", label: T("help.demo") }, { id: "howagents", label: T("help.agents") }, { id: "gloss", label: T("help.glossary") }, { id: "tour", label: T("help.tour") }]} />
      <div className="pt-4" role="tabpanel">
        {tab === "demo" && (<>
          <p className="mb-2 text-sm text-muted">{T("demo.intro")}</p>
          <div className="mb-3"><SummaryCard compact /></div>
          <ol className="list-decimal space-y-2 ps-5 text-sm leading-relaxed">{DEMO.map((n) => <li key={n}>{T(`demo.s${n}`)}</li>)}</ol>
        </>)}
        {tab === "howagents" && <HowAgentsWork />}
        {tab === "gloss" && <dl className="space-y-3 text-sm">{GLOSSARY.map((k) => <div key={k}><dt className="font-bold">{T(`gl.${k}.term`)}</dt><dd className="text-muted">{T(`gl.${k}.def`)}</dd></div>)}</dl>}
        {tab === "tour" && (<><p className="mb-3 text-sm text-muted">{T("help.tour_text")}</p><Btn tone="primary" onClick={onTour}>{T("help.tour_start")}</Btn></>)}
      </div>
    </Modal>
  );
}
