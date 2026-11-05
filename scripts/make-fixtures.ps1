# Generates the test-video matrix used for manual/integration verification.
# Idempotent: skips files that already exist. Run from the repo root.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/make-fixtures.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$ff = Join-Path $root "vendor/ffmpeg/bin/ffmpeg.exe"
$out = Join-Path $root "tests/fixtures/videos"
New-Item -ItemType Directory -Force -Path $out | Out-Null

if (-not (Test-Path $ff)) {
    Write-Error "ffmpeg not vendored - run scripts/fetch-ffmpeg.ps1 first."
}

$matrix = @(
    @{ name = "landscape_1080p_30"; size = "1920x1080"; fps = 30; dur = 3; audio = $true },
    @{ name = "portrait_9x16_30";   size = "1080x1920"; fps = 30; dur = 3; audio = $true },
    @{ name = "square_1x1_24";      size = "1080x1080"; fps = 24; dur = 3; audio = $true },
    @{ name = "portrait_4x5_60";    size = "864x1080";  fps = 60; dur = 2; audio = $true },
    @{ name = "landscape_720_25";   size = "1280x720";  fps = 25; dur = 3; audio = $false },
    @{ name = "odd_4x3_15";         size = "640x480";   fps = 15; dur = 2; audio = $true },
    @{ name = "rotated_90";         size = "1920x1080"; fps = 30; dur = 2; audio = $true; rotate = $true }
)

foreach ($m in $matrix) {
    $file = Join-Path $out ($m.name + ".mp4")
    if (Test-Path $file) { Write-Host ("skip " + $m.name); continue }
    $src = "testsrc2=size=" + $m.size + ":rate=" + $m.fps + ":duration=" + $m.dur
    $a = @("-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", $src)
    if ($m.audio) {
        $a += @("-f", "lavfi", "-i", ("sine=frequency=440:duration=" + $m.dur), "-c:a", "aac", "-b:a", "96k")
    } else {
        $a += @("-an")
    }
    if ($m.rotate) { $a += @("-metadata:s:v", "rotate=90") }
    $a += @("-c:v", "libopenh264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", $file)
    & $ff @a
    if ($LASTEXITCODE -ne 0) { Write-Error ("fixture failed: " + $m.name) }
    Write-Host ("made " + $m.name)
}
Write-Host ("fixtures ready: " + $out)
