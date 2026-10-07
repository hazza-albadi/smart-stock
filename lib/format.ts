export type Lang = "ar" | "en";

// Arabic UI uses Arabic-Indic numerals, English UI Latin numerals. Never prints NaN, Infinity or "-0".
const loc = (lang: Lang) => (lang === "ar" ? "ar-EG" : "en-US");
const clean = (n: number, dp: number) => {
  if (!Number.isFinite(n)) return null;
  const f = 10 ** dp;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) || r === 0 ? 0 : r;
};

export function num(lang: Lang, n: number | null | undefined, dp = 0): string {
  const r = clean(Number(n), dp);
  if (r === null) return "—";
  return r.toLocaleString(loc(lang), { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
/** Omani rial with 3 decimals (baisa). */
export const omrNum = (lang: Lang, n: number | null | undefined) => num(lang, n, 3);
export const pct = (lang: Lang, ratio: number) => `${num(lang, ratio * 100, 0)}%`;

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const dateLong = (lang: Lang, iso: string) =>
  new Intl.DateTimeFormat(loc(lang), { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(utc(iso));
export const dateMed = (lang: Lang, iso: string) =>
  new Intl.DateTimeFormat(loc(lang), { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(utc(iso));
export const dateShort = (lang: Lang, iso: string) =>
  new Intl.DateTimeFormat(loc(lang), { day: "numeric", month: "short", timeZone: "UTC" }).format(utc(iso));
export const clock = (lang: Lang, hour: number) => `${num(lang, Math.floor(hour), 0).padStart(2, lang === "ar" ? "٠" : "0")}:${num(lang, 0, 0).repeat(2)}`;
export const dateTime = (lang: Lang, iso: string, hour: number) => `${dateShort(lang, iso)} ${clock(lang, hour)}`;

/** Plural category of a count in the given language (Arabic has zero/one/two/few/many/other). */
export const pluralCat = (lang: Lang, n: number) => new Intl.PluralRules(lang === "ar" ? "ar" : "en").select(Math.round(n));
