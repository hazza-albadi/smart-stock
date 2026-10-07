import { addDays, diffDays } from "./time";

/** The simulation clock is one integer: hours since the start (tick). No JS Date objects are involved. */
export interface Clock { tick: number; day: number; hour: number; date: string }

export function clockAt(startDate: string, tick: number): Clock {
  const day = Math.floor(tick / 24);
  return { tick, day, hour: tick - day * 24, date: addDays(startDate, day) };
}
export const tickOf = (startDate: string, date: string, hour = 0): number => diffDays(date, startDate) * 24 + hour;
