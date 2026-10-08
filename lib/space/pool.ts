import { db } from "../db";
import { addDays } from "../time";
import { rand } from "../rng";
import type { Settings } from "../settings";

/**
 * The tenant pool: the five requests of the CSV plus a seeded set of SIMULATED companies (made-up names, areas, durations, start dates and price sensitivity).
 * Same seed, same pool. Every company gets a price factor (how much of the market price it is willing to pay).
 * A share of the simulated companies ask for storage that is never rented out (cold, hazardous): they are demand we cannot serve.
 */
export function generateTenantPool(cfg: Settings) {
  const d = db();
  const seed = cfg.n("sim.seed");
  const start = cfg.s("sim.start_date");
  const type = cfg.s("space.rentable_request_type");
  const step = cfg.n("space.area_step_m2");
  const n = Math.max(0, Math.floor(cfg.n("space.pool_extra_count")));
  const A = cfg.j<string[]>("space.pool_names_a"), B = cfg.j<string[]>("space.pool_names_b");
  const protectedTypes = (d.prepare(`SELECT DISTINCT storage_type t FROM warehouse_zones WHERE rent_allowed<>'yes' ORDER BY storage_type`).all() as { t: string }[]).map((r) => r.t)
    .filter((t) => t !== type);
  const fMin = cfg.n("space.pool_factor_min"), fMax = cfg.n("space.pool_factor_max");
  const between = (key: string, lo: number, hi: number) => lo + rand(`${seed}|pool|${key}`) * (hi - lo);

  // CSV companies get a price sensitivity too
  for (const r of d.prepare(`SELECT request_id FROM space_requests WHERE source='DATA'`).all() as { request_id: string }[])
    d.prepare(`UPDATE space_requests SET price_factor=? WHERE request_id=?`).run(Math.round(between(`csv|${r.request_id}`, fMin, fMax) * 1000) / 1000, r.request_id);

  const nProtected = protectedTypes.length ? Math.round((n * cfg.n("space.pool_protected_share_pct")) / 100) : 0;
  const used = new Set((d.prepare(`SELECT company FROM space_requests`).all() as { company: string }[]).map((r) => r.company));
  const ins = d.prepare(`INSERT INTO space_requests(request_id,company,required_storage_type,area_needed_m2,duration_months,needed_from,notes,source,created_tick,price_factor) VALUES(?,?,?,?,?,?,?,?,0,?)`);
  for (let i = 1; i <= n; i++) {
    const id = `SIM-${String(i).padStart(2, "0")}`;
    let name = `${A[Math.floor(rand(`${seed}|pool|${id}|a`) * A.length)]} ${B[Math.floor(rand(`${seed}|pool|${id}|b`) * B.length)]}`, k = 2;
    while (used.has(name)) name = `${name.replace(/ \d+$/, "")} ${k++}`;
    used.add(name);
    const prot = i > n - nProtected;
    const area = Math.max(step, Math.round(between(`${id}|area`, cfg.n("space.pool_area_min"), cfg.n("space.pool_area_max")) / step) * step);
    const months = Math.round(between(`${id}|months`, cfg.n("space.pool_months_min"), cfg.n("space.pool_months_max")));
    const from = addDays(start, Math.round(between(`${id}|from`, cfg.n("space.pool_start_min_days"), cfg.n("space.pool_start_max_days"))));
    ins.run(id, name, prot ? protectedTypes[(i - 1) % protectedTypes.length] : type, area, months, from, "Simulated company", "SIM", Math.round(between(`${id}|factor`, fMin, fMax) * 1000) / 1000);
  }
}
