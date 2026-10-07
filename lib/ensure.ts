import { db } from "./db";
import { seedDatabase } from "./seed";
import { runAll } from "./agents/coordinator";

/** First request after a fresh checkout: build the database from the CSVs if `npm run seed` was not run. */
export async function ensureSeeded() {
  const has = db().prepare(`SELECT 1 FROM sqlite_master WHERE name='sim_state'`).get();
  if (!has) {
    seedDatabase();
    await runAll({ useLlm: false, group: "start" });
  }
}
