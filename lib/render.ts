import { t, type Lang } from "./i18n";
import { num, omrNum, pct, dateMed, clock, dateShort } from "./format";

export interface Msg { k: string; v?: Record<string, unknown> }
export interface RenderCtx { items?: Record<string, { name_en: string; name_ar: string }> }

const alloc = (lang: Lang, s: string) =>
  s.split(",").filter(Boolean).map((p) => { const [a, z] = p.split("|"); return `${num(lang, Number(a))} ${t(lang, "fmt.m2")} ${z}`; }).join(" + ");

function fmtValue(lang: Lang, fmt: string, v: unknown, ctx: RenderCtx): string {
  const n = Number(v);
  switch (fmt) {
    case "n0": case "n1": case "n2": case "n3": return num(lang, n, Number(fmt[1]));
    case "omr": return `${omrNum(lang, n)} ${t(lang, "fmt.omr")}`;
    case "pct": return pct(lang, n);
    case "m2": return `${num(lang, n)} ${t(lang, "fmt.m2")}`;
    case "date": return typeof v === "string" && v ? dateMed(lang, v) : "—";
    case "clock": return clock(lang, n);
    case "dt": { const [d, h] = String(v).split("|"); return d ? `${dateShort(lang, d)} ${clock(lang, Number(h))}` : "—"; }
    case "ongoing": return n ? t(lang, "fmt.ongoing") : "";
    case "item": { const i = ctx.items?.[String(v)]; return i ? (lang === "ar" ? i.name_ar : i.name_en) : String(v); }
    case "unit": return t(lang, `unit.${v}`) === `unit.${v}` ? String(v) : t(lang, `unit.${v}`);
    case "zone": return String(v);
    case "zname": return v ? (t(lang, `zname.${v}`) === `zname.${v}` ? String(v) : t(lang, `zname.${v}`)) : "—";
    case "stype": return t(lang, `stype.${v}`) === `stype.${v}` ? String(v) : t(lang, `stype.${v}`);
    case "alloc": return alloc(lang, String(v));
    case "leases": return String(v).split(",").filter(Boolean).map((p) => { const [r, a, d] = p.split("|"); return `${r} (${num(lang, Number(a))} ${t(lang, "fmt.m2")} ${t(lang, "fmt.from")} ${dateMed(lang, d)})`; }).join("; ");
    case "emerg": return n ? ` ${t(lang, "fmt.emerg")}` : "";
    case "mkind": return t(lang, `mk.${v}`);
    case "sgn": return n < 0 ? "−" : "+";
    case "shortflag": return n ? "" : ` ${t(lang, "fmt.short")}`;
    case "orNone": return v ? String(v) : t(lang, "fmt.none");
    case "msg": return render(lang, v as Msg, ctx);
    default: return String(v ?? "");
  }
}

/** Renders a stored message ({k, v}) in the chosen language; numerals follow the language. Pure: no business numbers are computed here. */
export function render(lang: Lang, m: Msg | Msg[] | null | undefined, ctx: RenderCtx = {}): string {
  if (!m) return "";
  if (typeof m === "string") { const raw: string = m; try { m = JSON.parse(raw); } catch { return raw; } }
  if (Array.isArray(m)) return m.map((x) => render(lang, x, ctx)).filter(Boolean).join(" ");
  if (!(m as Msg).k) return "";
  const tpl = t(lang, (m as Msg).k);
  return tpl.replace(/\{(\w+)(?::(\w+))?\}/g, (_, name: string, fmt?: string) => fmtValue(lang, fmt ?? "txt", ((m as Msg).v ?? {})[name], ctx));
}
