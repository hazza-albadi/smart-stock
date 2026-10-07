// Dates are plain 'YYYY-MM-DD' strings handled in UTC so the simulation is timezone-proof.
export const DAY = 86400000;
export const toMs = (d: string) => Date.parse(d + "T00:00:00Z");
export const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fromMs(toMs(d) + n * DAY);
export const diffDays = (a: string, b: string) => Math.round((toMs(a) - toMs(b)) / DAY); // a - b

/** Calendar month arithmetic on 'YYYY-MM-DD' (clamps to the end of shorter months). */
export function addMonths(d: string, months: number): string {
  const [y, m, day] = d.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}
