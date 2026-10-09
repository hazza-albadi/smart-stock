import { db, ensureTables } from "./db";
import { seedDatabase, defaultSettings } from "./seed";
import { runAll } from "./agents/coordinator";
import { backfillDrafts } from "./drafts";
import { writeSummary } from "./summary";

/** First request after a fresh checkout: build the database from the CSVs if `npm run seed` was not run. */
export function ensureSeeded() {
  const has = db().prepare(`SELECT 1 FROM sqlite_master WHERE name='sim_state'`).get();
  const current = has && db().prepare(`SELECT 1 FROM sqlite_master WHERE name='space_listings'`).get();
  if (has && !current) { seedDatabase({ keepSettings: true }); runAll({ group: "start", trigger: "start" }); return; } // database from an older version
  if (!has) {
    seedDatabase();
    runAll({ group: "start", trigger: "start" });
    return;
  }
  // settings added by a newer version are inserted with their defaults (the user's own values stay)
  const have = new Set((db().prepare(`SELECT key FROM settings`).all() as { key: string }[]).map((r) => r.key));
  const add = defaultSettings().filter((d) => !have.has(d.key));
  if (add.length) db().transaction(() => { for (const d of add) db().prepare(`INSERT INTO settings(key,value,unit,description) VALUES(?,?,?,?)`).run(d.key, JSON.stringify(d.value), d.unit, d.description); })();
  // tables added by a newer version (stage log, daily summary, drafts): created without touching any data, then filled from what already exists
  const created = ensureTables();
  if (created.includes("drafts")) backfillDrafts();
  if (created.includes("daily_summary")) writeSummary("start");
}
