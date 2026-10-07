"use client";
import { createContext, useContext } from "react";
import { t, type Lang } from "@/lib/i18n";
import { render, duration, type Msg } from "@/lib/render";
import { num, omrNum, dateMed, dateLong, dateShort, clock } from "@/lib/format";

export interface Names { [id: string]: { name_en: string; name_ar: string; unit: string } }

/** Helpers bound to the language. They only format values received from the server; they depend on the language, the item names and the start date, never on the per-tick data. */
export interface AppApi {
  lang: Lang;
  T: (key: string) => string;
  R: (m: Msg | Msg[] | null | undefined) => string;
  N: (n: number | null | undefined, dp?: number) => string;
  OMR: (n: number | null | undefined) => string;
  D: (iso: string) => string;
  DL: (iso: string) => string;
  DS: (iso: string) => string;
  CK: (h: number) => string;
  DT: (tick: number) => string;
  DUR: (hours: number | null | undefined) => string;
  U: (unit: string) => string;
  name: (itemId: string | null | undefined) => string;
  name2: (itemId: string | null | undefined) => string;
  decide: (id: number, d: "APPROVED" | "REJECTED", o?: { qty?: number; variant?: string; area?: number }) => Promise<void>;
  postpone: (id: number) => Promise<void>;
  editQty: (id: number, qty: number) => Promise<void>;
  select: (itemId: string) => void;
  post: (url: string, body: unknown, method?: string) => Promise<any>;
  goTab: (tab: string) => void;
  confirm: (o: { title: string; body: string; action: string; danger?: boolean }) => Promise<boolean>;
}

export const AppCtx = createContext<AppApi | null>(null);
export const BusyCtx = createContext(false);
export const useBusy = () => useContext(BusyCtx);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error("AppCtx missing");
  return c;
};

export function makeApi(lang: Lang, names: Names, startDate: string): Pick<AppApi, "T" | "R" | "N" | "OMR" | "D" | "DL" | "DS" | "CK" | "DT" | "DUR" | "U" | "name" | "name2"> {
  const start = new Date(`${startDate}T00:00:00Z`);
  const dateOfDay = (day: number) => { if (Number.isNaN(start.getTime())) return "1970-01-01"; const d = new Date(start); d.setUTCDate(d.getUTCDate() + day); return d.toISOString().slice(0, 10); };
  return {
    T: (k) => t(lang, k),
    R: (m) => render(lang, m, { items: names }),
    N: (n, dp = 0) => num(lang, n, dp),
    OMR: (n) => `${omrNum(lang, n)} ${t(lang, "fmt.omr")}`,
    D: (iso) => dateMed(lang, iso), DL: (iso) => dateLong(lang, iso), DS: (iso) => dateShort(lang, iso), CK: (h) => clock(lang, h),
    DT: (tick) => !Number.isFinite(tick) ? "—" : `${dateShort(lang, dateOfDay(Math.floor(tick / 24)))} ${clock(lang, ((tick % 24) + 24) % 24)}`,
    DUR: (h) => duration(lang, h),
    U: (u) => (t(lang, `unit.${u}`) === `unit.${u}` ? u : t(lang, `unit.${u}`)),
    name: (id) => { const i = id ? names[id] : undefined; return i ? (lang === "ar" ? i.name_ar : i.name_en) : id ?? ""; },
    name2: (id) => { const i = id ? names[id] : undefined; return i ? (lang === "ar" ? i.name_en : i.name_ar) : ""; },
  };
}
