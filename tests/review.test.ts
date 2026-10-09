// Regression tests of the simulation review (docs/SIM_REVIEW.md). Each test names the finding it guards; each failed before its fix.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import en from "../locales/en.json";
import ar from "../locales/ar.json";
import { useDatabase, db, closeDb } from "../lib/db";
import { seedDatabase, defaultSettings } from "../lib/seed";
import { runAll } from "../lib/agents/coordinator";
import { tick } from "../lib/sim";
import { UserError } from "../lib/core";
import { loadSettings, setSetting, settingProblem } from "../lib/settings";

const file = path.join(os.tmpdir(), `smartstock-review-${process.pid}.db`);
const q = <T = any>(sql: string, ...a: unknown[]) => db().prepare(sql).all(...a) as T[];
const fresh = (seed = 42) => { seedDatabase({ overrides: { "sim.auto_pause_critical": false, "sim.seed": seed } }); runAll({ group: "start", trigger: "start" }); };
before(() => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(file + e, { force: true }); useDatabase(file); });
test.after(() => { closeDb(); for (const e of ["", "-wal", "-shm"]) fs.rmSync(file + e, { force: true }); });

const refusedWith = (fn: () => unknown, key: string) => assert.throws(fn, (e: unknown) => e instanceof UserError && e.msg.k === key, `expected a refusal ${key}`);

test("C1: a setting of the wrong kind is refused in plain words and the clock keeps running", () => {
  fresh();
  refusedWith(() => setSetting("schedule.forecast_hours", 6), "settings.err.type");
  refusedWith(() => setSetting("schedule.forecast_hours", [6, 24]), "settings.err.hours");
  refusedWith(() => setSetting("sim.auto_pause_critical", "false"), "settings.err.type");
  refusedWith(() => setSetting("space.forecast_days", 0), "settings.err.min");
  refusedWith(() => setSetting("demand.noise", -0.1), "settings.err.min");
  refusedWith(() => setSetting("space.offer_base_prob", 1.5), "settings.err.max");
  refusedWith(() => setSetting("sim.start_date", "5 Oct"), "settings.err.date");
  refusedWith(() => setSetting("demand.hourly_profile", [1, 2, 3]), "settings.err.type");
  refusedWith(() => setSetting("no.such.key", 1), "settings.err.unknown");
  assert.deepEqual(loadSettings().j<number[]>("schedule.forecast_hours"), [6], "nothing was stored");
  // valid values are still accepted
  setSetting("schedule.forecast_hours", [6, 18]);
  setSetting("sim.auto_pause_critical", false);
  setSetting("po.emergency_premium", 1.2); // a premium may be above 100 %
  setSetting("sim.utc_offset_hours", -3);
  assert.doesNotThrow(() => { for (let i = 0; i < 3; i++) tick(); });
});

test("C1: every default value passes its own check (the defaults never trip the validation)", () => {
  for (const d of defaultSettings()) assert.equal(settingProblem(d.key, d.value, d.value, d.unit), null, d.key);
});

test("M4: every text uses the same placeholders and formats in English and Arabic (no '[object Object]')", () => {
  const P = /\{(\w+)(?::(\w+))?\}/g;
  const sig = (s: string) => [...s.matchAll(P)].map((m) => `${m[1]}:${m[2] ?? ""}`).sort().join(",");
  const E = en as Record<string, string>, A = ar as Record<string, string>;
  const bad = Object.keys(E).filter((k) => sig(E[k]) !== sig(A[k] ?? ""));
  assert.deepEqual(bad, []);
});

void q;
