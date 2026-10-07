"use client";
import { createContext, useContext } from "react";
import type { Snapshot } from "@/lib/snapshot";
import { t, type Lang } from "@/lib/i18n";
import { render, type Msg } from "@/lib/render";
import { num, omrNum, dateMed, dateLong, dateShort, clock } from "@/lib/format";

export interface AppApi {
  lang: Lang; snap: Snapshot; busy: boolean;
  T: (key: string) => string;
  R: (m: Msg | Msg[] | null | undefined) => string;
  N: (n: number | null | undefined, dp?: number) => string;
  OMR: (n: number | null | undefined) => string;
  D: (iso: string) => string;
  DL: (iso: string) => string;
  DS: (iso: string) => string;
  CK: (h: number) => string;
  DT: (tick: number) => string;
  U: (unit: string) => string;
  name: (itemId: string | null | undefined) => string;
  name2: (itemId: string | null | undefined) => string;
  decide: (id: number, d: "APPROVED" | "REJECTED", o?: { qty?: number; variant?: string; area?: number }) => Promise<void>;
  editQty: (id: number, qty: number) => Promise<void>;
  select: (itemId: string) => void;
  post: (url: string, body: unknown) => Promise<any>;
}

export const AppCtx = createContext<AppApi | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error("AppCtx missing");
  return c;
};

/** Formatting helpers bound to a language: they only format values received from the server (no business numbers are computed here). */
export function makeApi(lang: Lang, snap: Snapshot): Pick<AppApi, "T" | "R" | "N" | "OMR" | "D" | "DL" | "DS" | "CK" | "DT" | "U" | "name" | "name2"> {
  const items = Object.fromEntries(snap.items.map((i) => [i.item_id, { name_en: i.name_en, name_ar: i.name_ar }]));
  const start = new Date(`${snap.sim.date}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - snap.sim.day);
  const dateOfDay = (day: number) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + day); return d.toISOString().slice(0, 10); };
  return {
    T: (k) => t(lang, k),
    R: (m) => render(lang, m, { items }),
    N: (n, dp = 0) => num(lang, n, dp),
    OMR: (n) => `${omrNum(lang, n)} ${t(lang, "fmt.omr")}`,
    D: (iso) => dateMed(lang, iso), DL: (iso) => dateLong(lang, iso), DS: (iso) => dateShort(lang, iso), CK: (h) => clock(lang, h),
    DT: (tick) => `${dateShort(lang, dateOfDay(Math.floor(tick / 24)))} ${clock(lang, ((tick % 24) + 24) % 24)}`,
    U: (u) => (t(lang, `unit.${u}`) === `unit.${u}` ? u : t(lang, `unit.${u}`)),
    name: (id) => { const i = id ? items[id] : undefined; return i ? (lang === "ar" ? i.name_ar : i.name_en) : id ?? ""; },
    name2: (id) => { const i = id ? items[id] : undefined; return i ? (lang === "ar" ? i.name_en : i.name_ar) : ""; },
  };
}
