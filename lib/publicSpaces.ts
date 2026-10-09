// Read-only view of the spaces that are on offer, for the public website. Only SELECTs: the website never changes the database.
import { db } from "./db";
import { loadSettings } from "./settings";
import { LISTING_REMAINING } from "./space/forecast";

export interface PublicSpace {
  id: string; zone_id: string; zone_name: string; storage_type: string;
  area: number; price: number; start: string | null; end: string | null; sample: boolean;
}

const all = <T>(sql: string, ...a: unknown[]) => db().prepare(sql).all(...a) as T[];

/** Published listings that still have unleased area. When there are none and `space.public_demo_samples` is on, three labelled samples are shown instead. */
export function publicSpaces(): PublicSpace[] {
  let listed: PublicSpace[] = [];
  try {
    listed = all<{ id: number; zone_id: string; zone_name: string; storage_type: string; rest: number; price: number; start_date: string; end_date: string }>(
      `SELECT l.id, l.zone_id, w.zone_name, w.storage_type, ${LISTING_REMAINING} AS rest, l.price, l.start_date, l.end_date
         FROM space_listings l JOIN warehouse_zones w ON w.zone_id = l.zone_id WHERE l.status = 'PUBLISHED' ORDER BY l.id`)
      .filter((r) => r.rest > 0)
      .map((r) => ({ id: `L${r.id}`, zone_id: r.zone_id, zone_name: r.zone_name, storage_type: r.storage_type, area: r.rest, price: r.price, start: r.start_date, end: r.end_date, sample: false }));
  } catch { /* no database yet: nothing is listed */ }
  if (listed.length) return listed;
  try {
    const cfg = loadSettings();
    if (!cfg.b("space.public_demo_samples")) return [];
    const zones = all<{ zone_id: string; zone_name: string; storage_type: string }>(`SELECT zone_id, zone_name, storage_type FROM warehouse_zones WHERE rent_allowed='yes' ORDER BY zone_id`);
    if (!zones.length) return [];
    return cfg.j<number[]>("space.public_demo_sample_areas").map((area, i) => {
      const z = zones[i % zones.length];
      return { id: `S${i + 1}`, zone_id: z.zone_id, zone_name: z.zone_name, storage_type: z.storage_type, area, price: cfg.n("space.price_suggested"), start: null, end: null, sample: true };
    });
  } catch { return []; }
}
