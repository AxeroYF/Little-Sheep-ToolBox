$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$downloads=Join-Path $root 'vendor/integrations-download'
New-Item -ItemType Directory -Path $downloads -Force | Out-Null
function Fetch([string]$Url,[string]$Path,[string]$Hash='') {
  $valid=Test-Path -LiteralPath $Path
  if($valid -and $Hash){$valid=(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -eq $Hash}
  if(!$valid){Invoke-WebRequest -Uri $Url -OutFile $Path -TimeoutSec 180}
  if($Hash -and (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Hash){throw "Component hash mismatch: $Path"}
}
Fetch 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/v0.9.6/LibreHardwareMonitor.zip' (Join-Path $downloads 'LibreHardwareMonitor-0.9.6.zip') '086d9f1b5a99e643edc2cfaaac16051685b551e4c5ac0b32a57c58c0e529c001'
Fetch 'https://codeload.github.com/LibreHardwareMonitor/LibreHardwareMonitor/zip/refs/tags/v0.9.6' (Join-Path $downloads 'LibreHardwareMonitor-0.9.6-source.zip') '28100b87fcd7a9a213c58fabe1174e4f3064975b5ab11799224766993ca1fbfc'
Expand-Archive -LiteralPath (Join-Path $downloads 'LibreHardwareMonitor-0.9.6.zip') -DestinationPath (Join-Path $root 'vendor/LibreHardwareMonitor-0.9.6') -Force
Expand-Archive -LiteralPath (Join-Path $downloads 'LibreHardwareMonitor-0.9.6-source.zip') -DestinationPath (Join-Path $downloads 'lhm-source') -Force
Fetch 'https://github.com/tesseract-ocr/tesseract/releases/download/5.5.3/tesseract-ocr-w64-setup-5.5.3.20260724.exe' (Join-Path $downloads 'tesseract-5.5.3.exe') 'bee9e3434bd94fd65387d9be28cd467a41f61b1275383b55b0f59a1331270ae4'
# 7zr and 7z only extract archives; neither installer is executed.
Fetch 'https://github.com/ip7z/7zip/releases/download/26.03/7zr.exe' (Join-Path $downloads '7zr.exe')
Fetch 'https://github.com/ip7z/7zip/releases/download/26.03/7z2603-x64.exe' (Join-Path $downloads '7z2603-x64.exe')
& (Join-Path $downloads '7zr.exe') x (Join-Path $downloads '7z2603-x64.exe') "-o$(Join-Path $downloads '7zip')" -y | Out-Null
if($LASTEXITCODE){throw '7-Zip extraction failed'}
& (Join-Path $downloads '7zip/7z.exe') x (Join-Path $downloads 'tesseract-5.5.3.exe') "-o$(Join-Path $root 'vendor/Tesseract-5.5.3')" -y | Out-Null
if($LASTEXITCODE){throw 'Tesseract extraction failed'}
$modelRoot=Join-Path $root 'vendor/Tesseract-5.5.3/tessdata'
$hashes=@{eng='7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2';chi_sim='a5fcb6f0db1e1d6d8522f39db4e848f05984669172e584e8d76b6b3141e1f730';osd='9cf5d576fcc47564f11265841e5ca839001e7e6f38ff7f7aacf46d15a96b00ff'}
foreach($model in @('eng','chi_sim','osd')){Fetch "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/87416418657359cb625c412a48b6e1d6d41c29bd/$model.traineddata" (Join-Path $modelRoot "$model.traineddata") $hashes[$model]}
Fetch 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/87416418657359cb625c412a48b6e1d6d41c29bd/LICENSE' (Join-Path $root 'vendor/Tesseract-5.5.3/LICENSE-models')
Fetch 'https://raw.githubusercontent.com/DanBloomberg/leptonica/1.87.0/leptonica-license.txt' (Join-Path $root 'vendor/Tesseract-5.5.3/LICENSE-leptonica')
Write-Output 'Fixed integration components prepared locally. No system installation performed.'
