// Generates docs/reports/baseline.json from the database (never typed by hand).
//   npx tsx scripts/baseline.ts            -> seeds a fresh DB, records the day-0 state + command results
//   npx tsx scripts/baseline.ts --state    -> prints only the day-0 state (used by tests / audit)
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { seedDatabase } from "../lib/seed";
import { runAll } from "../lib/agents/coordinator";
import { readDay0State } from "../lib/baselineState";

function main() {
  seedDatabase();
  runAll({ group: "start", trigger: "start" });
  const state = readDay0State();
  if (process.argv.includes("--state")) { console.log(JSON.stringify(state, null, 2)); return; }
  const run = (name: string, cmd: string, args: string[]) => {
    const r = spawnSync(cmd, args, { shell: true, encoding: "utf8", cwd: process.cwd() });
    return { name, command: [cmd, ...args].join(" "), exit_code: r.status, ok: r.status === 0 };
  };
  const commands = [
    run("typecheck", "npx", ["tsc", "--noEmit"]),
    run("build", "npm", ["run", "build"]),
    run("check", "npx", ["tsx", "scripts/check.ts"]),
  ];
  // the build leaves .next behind; the checks above re-seed the DB, so restore the day-0 DB
  seedDatabase();
  runAll({ group: "start", trigger: "start" });
  const out = { generated_by: "scripts/baseline.ts", commands, day0: state };
  fs.mkdirSync(path.join(process.cwd(), "docs", "reports"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), "docs", "reports", "baseline.json"), JSON.stringify(out, null, 2));
  console.log("wrote docs/reports/baseline.json", commands.map((c) => `${c.name}:${c.ok ? "ok" : "FAIL"}`).join(" "));
}
main();
