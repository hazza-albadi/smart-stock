// Dates are plain 'YYYY-MM-DD' strings handled in UTC so the simulation is timezone-proof.
export const DAY = 86400000;
export const toMs = (d: string) => Date.parse(d + "T00:00:00Z");
export const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fromMs(toMs(d) + n * DAY);
export const diffDays = (a: string, b: string) => Math.round((toMs(a) - toMs(b)) / DAY); // a - b
export const START_DATE = "2026-10-05";
export const HISTORY_END = "2026-10-03";
