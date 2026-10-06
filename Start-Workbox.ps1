$ErrorActionPreference = 'Stop'
$taskExe = Join-Path $PSScriptRoot 'desktop-dev/小羊工作箱.exe'
if (-not (Test-Path -LiteralPath $taskExe)) { throw 'Run npm run desktop:build first.' }
Start-Process -FilePath $taskExe -WorkingDirectory (Split-Path $taskExe)
