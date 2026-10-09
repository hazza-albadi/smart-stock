// npm run docs:agents — regenerates the agent table inside docs/ARCHITECTURE.md (and the one in README.md) from lib/agents/registry.ts and the locales.
// `--check` only compares and exits 1 when a document is out of date (the tests call the same functions).
import fs from "node:fs";
import path from "node:path";
import en from "../locales/en.json";
import ar from "../locales/ar.json";
import { agentTableBlock, agentTableCompact, replaceAgentTable } from "../lib/agents/doc-table";

const blocks: Record<string, string> = {
  "docs/ARCHITECTURE.md": agentTableBlock(en as Record<string, string>, ar as Record<string, string>),
  "README.md": agentTableCompact(en as Record<string, string>, ar as Record<string, string>),
};
const check = process.argv.includes("--check");
let stale = 0;
for (const [f, block] of Object.entries(blocks)) {
  const file = path.join(process.cwd(), f);
  const doc = fs.readFileSync(file, "utf8");
  const next = replaceAgentTable(doc, block);
  if (next === null) { console.error(`${f}: markers not found`); stale++; continue; }
  if (next === doc) { console.log(`${f}: agent table up to date`); continue; }
  if (check) { console.error(`${f}: agent table is out of date (run npm run docs:agents)`); stale++; continue; }
  fs.writeFileSync(file, next);
  console.log(`${f}: agent table regenerated`);
}
process.exit(stale ? 1 : 0);
