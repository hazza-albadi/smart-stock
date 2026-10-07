import en from "../locales/en.json";
import ar from "../locales/ar.json";
import type { Lang } from "./format";

export type { Lang };
const dict: Record<Lang, Record<string, string>> = { en, ar };

export const has = (lang: Lang, key: string) => key in dict[lang];
/** Translation lookup; falls back to English, then to the key itself (the i18n test makes sure no key is missing). */
export const t = (lang: Lang, key: string): string => dict[lang][key] ?? dict.en[key] ?? key;
