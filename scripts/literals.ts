// npm run literals — repo-wide search for hard-coded business literals in app/, components/, lib/ (excluding the seed loader's CSV parsing).
// Item ids, zone ids, request ids, PO ids and known budget / space / seasonality figures must come from the data or the settings table.
import fs from "node:fs";
import path from "node:path";

const roots = ["app", "components", "lib"];
const patterns: [string, RegExp][] = [
  ["item id (SKU-nnn)", /SKU-\d+/g],
  ["zone id (Z1-Z5)", /["'`]Z[1-5]["'`]|\bZ[1-5]\b/g],
  ["request id (REQ-nn)", /REQ-\d+/g],
  ["PO id (PO-nnn)", /PO-\d{3}/g],
  ["budget / space figures", /\b(18000|14012|14010|3990|1400)\b/g],
  ["seasonality rate 1.8", /\b1\.8\b/g],
  ["supplier / company names", /Al Bahr|Coastal Fisheries|Industrial Chemicals|Al Noor|Muscat Fresh|Gulf Chemicals|Batinah|Sohar Packaging|Qeshour/g],
];
const files: string[] = [];
const walk = (d: string) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f.name)) files.push(p); } };
roots.forEach(walk);
let total = 0;
for (const f of files) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => { for (const [name, re] of patterns) { re.lastIndex = 0; const m = l.match(re); if (m) { total += m.length; console.log(`${f}:${i + 1}  [${name}]  ${l.trim().slice(0, 110)}`); } } });
}
console.log(total === 0 ? "\nNo hard-coded literals found." : `\n${total} literal(s) found.`);
process.exit(total === 0 ? 0 : 1);
