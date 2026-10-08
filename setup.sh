#!/usr/bin/env bash
# First-time setup for macOS / Linux: check Node, install, seed, start. Stops with a clear message on any failure.
set -euo pipefail
cd "$(dirname "$0")"

fail() { echo; echo "ERROR / خطأ: $1"; echo "Fix it and run ./setup.sh again. / أصلح المشكلة ثم شغّل ./setup.sh من جديد."; exit 1; }

command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Install Node 22 or newer from https://nodejs.org (or: nvm install 22). / ثبّت Node 22 أو أحدث."
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$NODE_MAJOR" -ge 22 ] || fail "Node $(node -v) is too old; Node 22+ is required (nvm install 22 && nvm use 22). / إصدار Node قديم، المطلوب 22 أو أحدث."
command -v npm >/dev/null 2>&1 || fail "npm was not found. Reinstall Node.js. / لم يُعثر على npm."
[ -d smartstock_data ] || fail "The smartstock_data folder is missing (git checkout -- smartstock_data). / مجلد smartstock_data مفقود."

echo "== 1/4 Installing packages (npm ci) =="
if [ -f package-lock.json ]; then npm ci || fail "npm ci failed. Check `node -v` (22+); do not delete .npmrc; see req.txt section 2 for compiler tools. / فشل التثبيت."; else npm install || fail "npm install failed."; fi

echo "== 2/4 Checking this computer (npm run doctor) =="
npm run doctor || fail "The environment check found a problem (see above)."

echo "== 3/4 Creating the database from the CSV files (npm run seed) =="
npm run seed || fail "Seeding failed. Delete smartstock.db* and try again. / فشل بناء قاعدة البيانات."

echo "== 4/4 Starting SmartStock =="
echo "Open http://localhost:${PORT:-3000}  (Ctrl+C to stop) / افتح الرابط أعلاه"
exec npm run dev
