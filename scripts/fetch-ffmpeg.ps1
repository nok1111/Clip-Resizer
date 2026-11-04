# Downloads the pinned FFmpeg LGPL build (BtbN/FFmpeg-Builds, 9.0 release
# branch) into vendor/ffmpeg. The binary is never committed — run this
# before building/testing locally.
#
# Build choice (docs/CLIP_RESIZER_ARCHITECTURE.md §3.2): LGPL variant —
# no libx264/libx265, but includes h264_mf/hevc_mf (Media Foundation,
# baseline on all Win10/11), hw encoders, libopenh264 and libkvazaar.
$ErrorActionPreference = 'Stop'

$Version  = 'n9.0.2-47-gb204e94e90 (autobuild-2026-11-04-12-51)'
$Url      = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-11-04-12-51/ffmpeg-n9.0.2-47-gb204e94e90-win64-lgpl-9.0.zip'
$Sha256   = 'b0c31bfb357a54131eba431fc2e313157109e457e82d89c9117915892252909c'
$OutDir   = Join-Path $PSScriptRoot '..\vendor\ffmpeg'
$Archive  = Join-Path $env:TEMP 'ffmpeg-win64-lgpl.zip'

if (Test-Path (Join-Path $OutDir 'bin\ffmpeg.exe')) {
    Write-Host "ffmpeg.exe already present in vendor/ffmpeg — delete it to refetch."
    exit 0
}

Write-Host "Downloading $Url ..."
Invoke-WebRequest -Uri $Url -OutFile $Archive

$hash = (Get-FileHash $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -ne $Sha256) {
    throw "SHA-256 mismatch for ffmpeg: expected $Sha256, got $hash"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stage = Join-Path $env:TEMP 'ffmpeg-extract'
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
Expand-Archive -Path $Archive -DestinationPath $stage
$inner = Get-ChildItem $stage -Directory | Select-Object -First 1
Move-Item (Join-Path $inner.FullName 'bin') (Join-Path $OutDir 'bin')
Move-Item (Join-Path $inner.FullName 'LICENSE.txt') (Join-Path $OutDir 'LICENSE.txt') -ErrorAction SilentlyContinue
Move-Item (Join-Path $inner.FullName 'README.txt') (Join-Path $OutDir 'README.txt') -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $stage
Write-Host "FFmpeg $Version installed to $OutDir"
