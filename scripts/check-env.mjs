// npm run doctor — checks that this computer can run SmartStock and prints clear fix instructions in English and Arabic.
//   node scripts/check-env.mjs            full report (always exits 0 unless something blocks the app)
//   node scripts/check-env.mjs --pre      quiet mode used automatically before `npm run dev`: prints only problems that block the app
// Plain Node (no dependencies), so it also works before `npm install`.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pre = process.argv.includes("--pre");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const need = pkg.engines?.node ?? ">=22.0.0";
const minMajor = Number((need.match(/(\d+)/) ?? [])[1] ?? 22);
const port = Number(process.env.PORT || 3000);

const rows = [];
const add = (level, name, detail, fixEn, fixAr) => rows.push({ level, name, detail, fixEn, fixAr });
const have = (...p) => fs.existsSync(path.join(root, ...p));

// 1) Node
const major = Number(process.versions.node.split(".")[0]);
if (major >= minMajor) add("ok", "Node.js", `v${process.versions.node} (needs ${need})`);
else add("error", "Node.js", `v${process.versions.node} is too old (needs ${need})`,
  `Install Node ${minMajor} or newer from https://nodejs.org (LTS), or run: nvm install ${minMajor} && nvm use ${minMajor}  (Windows: nvm-windows, or winget install OpenJS.NodeJS.LTS). Then open a NEW terminal.`,
  `ثبّت Node ${minMajor} أو أحدث من https://nodejs.org (نسخة LTS)، أو نفّذ: nvm install ${minMajor} ثم nvm use ${minMajor} (على ويندوز: nvm-windows أو winget install OpenJS.NodeJS.LTS). ثم افتح نافذة طرفية جديدة.`);

// 2) npm
try {
  const v = execSync("npm -v", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  const npmNeed = Number((pkg.engines?.npm ?? ">=10").match(/(\d+)/)?.[1] ?? 10);
  if (Number(v.split(".")[0]) >= npmNeed) add("ok", "npm", `v${v}`);
  else add("warn", "npm", `v${v} (recommended >= ${npmNeed})`, `Run: npm install -g npm@latest`, `نفّذ: npm install -g npm@latest`);
} catch { add("error", "npm", "not found", "Install Node.js again (npm comes with it).", "أعد تثبيت Node.js (يأتي npm معه)."); }

// 3) Git (only needed to clone / switch branch)
try { add("ok", "Git", execSync("git --version", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()); }
catch { add("info", "Git", "not found (only needed to clone the project)", "Install from https://git-scm.com/downloads", "ثبّته من https://git-scm.com/downloads"); }

// 4) required folders and files
const dataFiles = ["items", "suppliers", "stock_movements", "current_stock", "purchase_orders_open", "purchasing_budget", "warehouse_zones", "space_requests"].map((f) => `${f}.csv`);
const missingData = !have("smartstock_data") ? ["smartstock_data/"] : dataFiles.filter((f) => !have("smartstock_data", f)).map((f) => `smartstock_data/${f}`);
if (!missingData.length) add("ok", "Data files", "smartstock_data/ is complete (8 CSV files)");
else add("error", "Data files", `missing: ${missingData.join(", ")}`,
  "The simulation is built from these CSV files. Copy the smartstock_data folder into the project root (or run: git checkout -- smartstock_data). Without it the first page load fails with a file-not-found error.",
  "تُبنى المحاكاة من ملفات CSV هذه. انسخ مجلد smartstock_data إلى جذر المشروع (أو نفّذ: git checkout -- smartstock_data). بدونه تفشل أول صفحة بخطأ ملف غير موجود.");
const cfg = ["config/defaults.json", "locales/en.json", "locales/ar.json", "package-lock.json"].filter((f) => !have(...f.split("/")));
if (!cfg.length) add("ok", "Project files", "config, locales and lock file present");
else add("error", "Project files", `missing: ${cfg.join(", ")}`, "The checkout is incomplete. Re-clone the repository or run: git checkout -- .", "النسخة ناقصة. أعد استنساخ المستودع أو نفّذ: git checkout -- .");

// 5) dependencies installed + native SQLite module loads
if (!have("node_modules")) add(pre ? "error" : "warn", "Dependencies", "node_modules is missing", "Run: npm ci   (or npm install)", "نفّذ: npm ci (أو npm install)");
else {
  try {
    const req = createRequire(path.join(root, "package.json"));
    const Database = req("better-sqlite3");
    const d = new Database(":memory:"); d.prepare("select 1").get(); d.close();
    add("ok", "SQLite module", "better-sqlite3 loads (native binary works)");
  } catch (e) {
    add("error", "SQLite module", `better-sqlite3 cannot load: ${String(e.message).split("\n")[0]}`,
      "Run: npm rebuild better-sqlite3   — if that fails install a compiler: Windows: install Visual Studio Build Tools ('Desktop development with C++') and Python 3; macOS: xcode-select --install; Linux: sudo apt install build-essential python3. Also check that Node is >= " + minMajor + ".",
      "نفّذ: npm rebuild better-sqlite3 — وإن فشل ثبّت المترجم: ويندوز: Visual Studio Build Tools (Desktop development with C++) مع Python 3؛ ماك: xcode-select --install؛ لينكس: sudo apt install build-essential python3. وتأكد أن Node ≥ " + minMajor + ".");
  }
}

// 6) port
const free = await new Promise((resolve) => {
  const s = net.createServer();
  s.once("error", () => resolve(false));
  s.once("listening", () => s.close(() => resolve(true)));
  s.listen(port, "127.0.0.1");
});
if (free) add("ok", "Port", `${port} is free`);
else add("warn", "Port", `${port} is already in use (Next.js will pick the next free port and print it)`,
  `Close the other program, or choose another port: PowerShell: $env:PORT=3100; npm run dev   |   bash: PORT=3100 npm run dev`,
  `أغلق البرنامج الآخر أو اختر منفذاً آخر: PowerShell: $env:PORT=3100; npm run dev  |  bash: PORT=3100 npm run dev`);

// 7) database
if (have("smartstock.db")) add("ok", "Database", "smartstock.db exists (kept between runs)");
else add("info", "Database", "smartstock.db not found: it is created automatically from the CSV files", "Optional: npm run seed", "اختياري: npm run seed");

// 8) optional settings
const envLocal = have(".env.local") && /ANTHROPIC_API_KEY\s*=\s*\S+/.test(fs.readFileSync(path.join(root, ".env.local"), "utf8"));
add("info", "Optional AI wording", process.env.ANTHROPIC_API_KEY || envLocal ? "ANTHROPIC_API_KEY is set (only polishes supplier-message wording)" : "no ANTHROPIC_API_KEY: fine, the app works fully without it");

const blocking = rows.filter((r) => r.level === "error");
if (pre) {
  if (blocking.length) { print(blocking); process.exit(1); }
  process.exit(0);
}
print(rows);
console.log(blocking.length ? `\n✖ ${blocking.length} problem(s) must be fixed first / توجد ${blocking.length} مشكلة يجب إصلاحها أولاً.` : "\n✔ This computer is ready. Run: npm run dev   |   الجهاز جاهز. نفّذ: npm run dev");
process.exit(blocking.length ? 1 : 0);

function print(list) {
  const icon = { ok: "✔", warn: "▲", error: "✖", info: "ℹ" };
  console.log("SmartStock doctor / فحص البيئة\n");
  for (const r of list) {
    console.log(`${icon[r.level]} ${r.name}: ${r.detail}`);
    if (r.fixEn && r.level !== "ok") { console.log(`    EN: ${r.fixEn}`); console.log(`    AR: ${r.fixAr}`); }
  }
}
