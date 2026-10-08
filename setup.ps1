# First-time setup for Windows (PowerShell): check Node, install, seed, start. Stops with a clear message on any failure.
# If scripts are blocked:  powershell -ExecutionPolicy Bypass -File .\setup.ps1
$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
Set-Location -Path $PSScriptRoot

function Stop-Setup([string]$msg) {
  Write-Host ""
  Write-Host "ERROR / خطأ: $msg" -ForegroundColor Red
  Write-Host "Fix it and run .\setup.ps1 again. / أصلح المشكلة ثم شغّل .\setup.ps1 من جديد." -ForegroundColor Yellow
  exit 1
}
function Run-Step([string]$cmd, [string]$onFail) {
  Invoke-Expression $cmd
  if ($LASTEXITCODE -ne 0) { Stop-Setup $onFail }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Stop-Setup "Node.js is not installed. Install Node 22 or newer from https://nodejs.org (or: winget install OpenJS.NodeJS.LTS), then open a NEW PowerShell. / ثبّت Node 22 أو أحدث." }
$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt 22) { Stop-Setup "Node $(node -v) is too old; Node 22+ is required. / إصدار Node قديم، المطلوب 22 أو أحدث." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Stop-Setup "npm was not found. Reinstall Node.js. / لم يُعثر على npm." }
if (-not (Test-Path "smartstock_data")) { Stop-Setup "The smartstock_data folder is missing (git checkout -- smartstock_data). / مجلد smartstock_data مفقود." }

Write-Host "== 1/4 Installing packages (npm ci) =="
if (Test-Path "package-lock.json") { Run-Step "npm ci" "npm ci failed. Do not delete .npmrc (it makes npm use the prebuilt SQLite binary). If the message still mentions better-sqlite3 or node-gyp, check `node -v` (22+) and see req.txt section 2. / فشل التثبيت." }
else { Run-Step "npm install" "npm install failed." }

Write-Host "== 2/4 Checking this computer (npm run doctor) =="
Run-Step "npm run doctor" "The environment check found a problem (see above)."

Write-Host "== 3/4 Creating the database from the CSV files (npm run seed) =="
Run-Step "npm run seed" "Seeding failed. Delete smartstock.db* and try again. / فشل بناء قاعدة البيانات."

Write-Host "== 4/4 Starting SmartStock =="
$port = if ($env:PORT) { $env:PORT } else { "3000" }
Write-Host "Open http://localhost:$port  (Ctrl+C to stop) / افتح الرابط أعلاه"
npm run dev
