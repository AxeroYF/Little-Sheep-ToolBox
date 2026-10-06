$ErrorActionPreference = 'Stop'
$videoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$videoDownloads = Join-Path $videoRoot 'vendor/video-download'
New-Item -ItemType Directory -Force -Path $videoDownloads | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function Get-VideoArchive([string]$Url, [string]$Name, [string]$Hash) {
    $destination = Join-Path $videoDownloads $Name
    if (!(Test-Path -LiteralPath $destination)) {
        $partial = "$destination.partial"
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $partial
        if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Hash) { throw "Download hash mismatch: $Name" }
        Move-Item -LiteralPath $partial -Destination $destination
    }
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Hash) { throw "Archive hash mismatch: $Name" }
    return $destination
}
$videoPackage = Get-VideoArchive 'https://globalcdn.nuget.org/packages/videolan.libvlc.windows.3.0.24.nupkg' 'libvlc-windows-3.0.24.nupkg' '3da3f37ee2b2b10e5c788d830a3b513658c36521ea1b0f966ed86eb69f41ef3c'
$videoSource = Get-VideoArchive 'https://download.videolan.org/pub/videolan/vlc/3.0.24/vlc-3.0.24.tar.xz' 'vlc-3.0.24.tar.xz' 'e7cab503d1d7d5849b89d2cf0e1ee60d0ef6d012407791b644b9cfc0cc225fdf'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$videoExtract = [IO.Path]::GetFullPath((Join-Path $videoRoot 'vendor/LibVLC-3.0.24'))
$videoZip = [IO.Compression.ZipFile]::OpenRead($videoPackage)
try {
    foreach ($entry in $videoZip.Entries) {
        if (!$entry.Name -or !($entry.FullName.StartsWith('build/x64/') -or $entry.FullName -eq 'VideoLAN.LibVLC.Windows.nuspec')) { continue }
        $target = [IO.Path]::GetFullPath((Join-Path $videoExtract $entry.FullName))
        if (!$target.StartsWith($videoExtract + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe archive entry' }
        New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($target)) | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
    }
} finally { $videoZip.Dispose() }
$videoSourceDirectory = Join-Path $videoRoot 'vendor/video-source'
New-Item -ItemType Directory -Force -Path $videoSourceDirectory | Out-Null
& tar -xf $videoSource -C $videoSourceDirectory 'vlc-3.0.24/COPYING' 'vlc-3.0.24/COPYING.LIB'
if ($LASTEXITCODE -ne 0) { throw 'Source license extraction failed' }
Write-Output 'Pinned LibVLC 3.0.24 x64 runtime and corresponding source are ready.'
