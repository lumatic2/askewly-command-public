param(
  [string]$BinDir = "$HOME\.local\bin"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$cliPath = Join-Path $repoRoot "scripts\askewly-command.js"
if (!(Test-Path $cliPath)) {
  throw "Askewly CLI script not found: $cliPath"
}

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

$cmdPath = Join-Path $BinDir "askewly.cmd"
$ps1Path = Join-Path $BinDir "askewly.ps1"

$cmdContent = @"
@echo off
node "$cliPath" %*
"@

$ps1Content = @"
& node "$cliPath" @args
exit `$LASTEXITCODE
"@

Set-Content -LiteralPath $cmdPath -Value $cmdContent -Encoding ASCII
Set-Content -LiteralPath $ps1Path -Value $ps1Content -Encoding UTF8

Write-Host "Installed askewly CLI shims:"
Write-Host "  $cmdPath"
Write-Host "  $ps1Path"
Write-Host ""
Write-Host "Try: askewly --help"
