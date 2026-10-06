$ErrorActionPreference = 'Stop'
$workboxRoot = Split-Path $PSScriptRoot -Parent
$vendorPath = Join-Path $workboxRoot 'vendor'
New-Item -ItemType Directory -Force $vendorPath | Out-Null
$archivePath = Join-Path $vendorPath 'ShareX-21.0.0-portable-x64.zip'
$expectedHash = '8124938fa718d702bb08ef29292f0140052bdad03d23b3041b5015054ff1c230'
if (!(Test-Path -LiteralPath $archivePath)) {
    Invoke-WebRequest 'https://github.com/ShareX/ShareX/releases/download/v21.0.0/ShareX-21.0.0-portable-x64.zip' -OutFile $archivePath
}
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) {
    throw 'ShareX archive hash mismatch. Download was not extracted.'
}
Expand-Archive -LiteralPath $archivePath -DestinationPath (Join-Path $vendorPath 'ShareX-21.0.0') -Force
Invoke-WebRequest 'https://raw.githubusercontent.com/ShareX/ShareX/v21.0.0/LICENSE.txt' -OutFile (Join-Path $vendorPath 'ShareX-LICENSE.txt')
Invoke-WebRequest 'https://github.com/ShareX/ShareX/archive/refs/tags/v21.0.0.zip' -OutFile (Join-Path $vendorPath 'ShareX-21.0.0-source.zip')
Write-Output 'ShareX 21.0.0 prepared and verified.'
