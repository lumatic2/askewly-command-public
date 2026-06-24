$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "Askewly Command.lnk"
$desktopShortcutPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "Askewly Command.lnk"
$targetPath = "wscript.exe"
$arguments = "`"$projectRoot\\start_workspace_pulse.vbs`""
$iconPath = Join-Path $projectRoot "assets\\icon.ico"

$shell = New-Object -ComObject WScript.Shell

foreach ($path in @($shortcutPath, $desktopShortcutPath)) {
    $shortcut = $shell.CreateShortcut($path)
    $shortcut.TargetPath = $targetPath
    $shortcut.Arguments = $arguments
    $shortcut.WorkingDirectory = $projectRoot
    if (Test-Path $iconPath) {
        $shortcut.IconLocation = "$iconPath,0"
    }
    $shortcut.Save()
}

Write-Output $shortcutPath
Write-Output $desktopShortcutPath
