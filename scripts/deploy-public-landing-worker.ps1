# Deploy dashboard.askewly.com public landing through Cloudflare Worker assets.
#
# Requires Cloudflare credentials in the environment. Do not print token values.

param(
  [switch]$DryRun
)

$ROOT = Split-Path $PSScriptRoot -Parent
$WORKER = Join-Path $ROOT "scripts/cloudflare-dashboard-landing-worker.js"
$DIST = Join-Path $ROOT "web/dist"

Write-Host "Building public landing..."
npm --prefix (Join-Path $ROOT "web") run build
if ($LASTEXITCODE -ne 0) {
  throw "Public web build failed."
}

Write-Host "Checking Worker syntax..."
node --check $WORKER
if ($LASTEXITCODE -ne 0) {
  throw "Worker syntax check failed."
}

if ($DryRun) {
  Write-Host "Dry run complete. Would deploy dashboard-landing to dashboard.askewly.com/* using assets at $DIST."
  exit 0
}

Write-Host "Deploying Cloudflare Worker assets..."
npx wrangler deploy $WORKER `
  --name dashboard-landing `
  --assets $DIST `
  --route dashboard.askewly.com/* `
  --compatibility-date 2026-06-23
if ($LASTEXITCODE -ne 0) {
  throw "Cloudflare Worker deploy failed."
}

Write-Host "Done. Verify with:"
Write-Host "  https://dashboard.askewly.com/"
Write-Host "  https://dashboard.askewly.com/api/health"
