$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$electron = Join-Path $projectRoot "node_modules\\electron\\dist\\electron.exe"
$mountScript = Join-Path $projectRoot "scripts\\ensure-vault-mount.ps1"

if (-not (Test-Path $electron)) {
    throw "Electron is not installed. Run 'npm install' in $projectRoot first."
}

Set-Location $projectRoot
if (Test-Path $mountScript) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $mountScript | Out-Null
}
& $electron "."
