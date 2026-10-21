# Puts a "LemonCode" shortcut on the Desktop that starts the app with the repo's Electron.
$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) { throw "Electron isn't installed yet: run 'npm install' in $root first." }
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'LemonCode.lnk'
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = $electron
$s.Arguments = "`"$root`""
$s.WorkingDirectory = $root
$s.IconLocation = Join-Path $root 'build\icon.ico'
$s.Description = 'LemonCode: Claude Code with Citron'
$s.Save()
Write-Output "Shortcut saved: $lnk"
