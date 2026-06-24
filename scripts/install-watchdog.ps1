# Askewly Command — watchdog 작업 스케줄러 등록
#
# 2분마다 watchdog.ps1 을 현재 사용자 세션(interactive)에서 실행. freeze/crash 시
# electron 을 자동 재기동한다. 재실행해도 /F 로 덮어쓰므로 안전.

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$watchdog    = Join-Path $projectRoot "scripts\watchdog.ps1"
$taskName    = "AskewlyCommandWatchdog"

if (-not (Test-Path $watchdog)) {
  throw "watchdog.ps1 not found at $watchdog"
}

$tr = 'powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $watchdog

# /SC MINUTE /MO 2 → 2분마다 무기한 반복. /IT → 사용자 로그온 세션에서 실행(창 표시 가능).
schtasks /Create /TN $taskName /TR $tr /SC MINUTE /MO 2 /IT /RL LIMITED /F | Out-Null

Write-Output "Registered scheduled task: $taskName (every 2 min)"
schtasks /Query /TN $taskName /FO LIST | Select-String "TaskName|Status|Schedule"
