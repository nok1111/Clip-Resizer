//! FFmpeg/FFprobe process wrapper: locates the vendored binaries, probes
//! metadata and renders thumbnails/frames. Never loads video into memory —
//! everything goes through the external processes.

use std::path::{Path, PathBuf};
use std::process::Command;

use cr_model::{ProbeError, ProbeResult, VideoMeta};

pub mod render;

#[derive(Debug, thiserror::Error)]
pub enum FfmpegError {
    #[error("ffmpeg/ffprobe binaries not found — run scripts/fetch-ffmpeg.ps1")]
    Missing,
    #[error("could not start {tool}: {source}")]
    Spawn {
        tool: &'static str,
        source: std::io::Error,
    },
    #[error("{tool} failed (exit {code:?}): {detail}")]
    Process {
        tool: &'static str,
        code: Option<i32>,
        detail: String,
    },
    #[error("ffprobe output could not be parsed: {0}")]
    Parse(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

/// Directory containing ffmpeg.exe/ffprobe.exe. Resolution order:
/// `CLIP_FFMPEG_DIR` env → `vendor/ffmpeg/bin` next to the exe →
/// `vendor/ffmpeg/bin` under the current dir (development fallback).
pub fn bin_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CLIP_FFMPEG_DIR") {
        let d = PathBuf::from(dir);
        if ffmpeg_bin(&d).is_file() {
            return Some(d);
        }
    }
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));
    for cand in [
        exe_dir.as_ref().map(|d| d.join("ffmpeg")),
        exe_dir.as_ref().map(|d| d.join("vendor").join("ffmpeg").join("bin")),
        Some(PathBuf::from("vendor").join("ffmpeg").join("bin")),
    ]
    .into_iter()
    .flatten()
    {
        if ffmpeg_bin(&cand).is_file() {
            return Some(cand);
        }
    }
    // Development layout: <repo>/vendor/ffmpeg/bin relative to workspace root
    // discovered by walking up from the exe (target/debug/...).
    if let Some(mut dir) = exe_dir {
        for _ in 0..6 {
            let cand = dir.join("vendor").join("ffmpeg").join("bin");
            if ffmpeg_bin(&cand).is_file() {
                return Some(cand);
            }
            if !dir.pop() {
                break;
            }
        }
    }
    None
}

fn ffmpeg_bin(dir: &Path) -> PathBuf {
    dir.join(if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    })
}

fn ffprobe_bin(dir: &Path) -> PathBuf {
    dir.join(if cfg!(windows) {
        "ffprobe.exe"
    } else {
        "ffprobe"
    })
}

pub fn ffmpeg() -> Result<PathBuf, FfmpegError> {
    let dir = bin_dir().ok_or(FfmpegError::Missing)?;
    Ok(ffmpeg_bin(&dir))
}

pub fn ffprobe() -> Result<PathBuf, FfmpegError> {
    let dir = bin_dir().ok_or(FfmpegError::Missing)?;
    let p = ffprobe_bin(&dir);
    if p.is_file() {
        Ok(p)
    } else {
        Err(FfmpegError::Missing)
    }
}

/// `ffmpeg -version` first line, e.g. "ffmpeg version n9.0.2-... Copyright ...".
pub fn version() -> Option<String> {
    let out = Command::new(ffmpeg().ok()?)
        .arg("-version")
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    stdout.lines().next().map(|l| l.trim().to_string())
}

/// Probes many files on up to 4 OS threads (ffprobe is a separate process
/// per file anyway, so parallelism is cheap and bounded).
pub fn probe_many(paths: &[PathBuf]) -> Vec<ProbeResult> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let next = AtomicUsize::new(0);
    let out = std::sync::Mutex::new(Vec::with_capacity(paths.len()));
    let workers = paths.len().clamp(1, 4);
    std::thread::scope(|s| {
        for _ in 0..workers {
            s.spawn(|| loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                let Some(p) = paths.get(i) else { break };
                let r = probe(p);
                out.lock().unwrap().push((i, r));
            });
        }
    });
    let mut indexed = out.into_inner().unwrap();
    indexed.sort_by_key(|(i, _)| *i);
    indexed.into_iter().map(|(_, r)| r).collect()
}

/// Runs `ffprobe -print_format json -show_format -show_streams` on `path`.
pub fn probe(path: &Path) -> ProbeResult {
    let key = path.to_string_lossy().into_owned();
    match probe_inner(path) {
        Ok(meta) => ProbeResult {
            path: key,
            meta: Some(meta),
            error: None,
        },
        Err(e) => ProbeResult {
            path: key,
            meta: None,
            error: Some(ProbeError {
                code: e.code().to_string(),
                message: e.to_string(),
            }),
        },
    }
}

impl FfmpegError {
    fn code(&self) -> &'static str {
        match self {
            FfmpegError::Missing => "missing_ffmpeg",
            FfmpegError::Spawn { .. } => "spawn_failed",
            FfmpegError::Process { .. } => "ffprobe_failed",
            FfmpegError::Parse(_) => "parse_failed",
            FfmpegError::Io(_) => "io",
        }
    }
}

fn probe_inner(path: &Path) -> Result<VideoMeta, FfmpegError> {
    let out = Command::new(ffprobe()?)
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(path)
        .output()
        .map_err(|e| FfmpegError::Spawn {
            tool: "ffprobe",
            source: e,
        })?;
    if !out.status.success() {
        return Err(FfmpegError::Process {
            tool: "ffprobe",
            code: out.status.code(),
            detail: tail(&out.stderr),
        });
    }
    let v: serde_json::Value = serde_json::from_slice(&out.stdout)
        .map_err(|e| FfmpegError::Parse(e.to_string()))?;
    parse_probe(&v).map_err(FfmpegError::Parse)
}

pub(crate) fn tail(stderr: &[u8]) -> String {
    let s = String::from_utf8_lossy(stderr);
    s.lines()
        .rev()
        .take(6)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n")
}

/// Parses ffprobe JSON into VideoMeta. Public for unit tests with fixtures.
pub fn parse_probe(v: &serde_json::Value) -> Result<VideoMeta, String> {
    let streams = v
        .get("streams")
        .and_then(|s| s.as_array())
        .ok_or("no streams array")?;
    let vstream = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(|t| t.as_str()) == Some("video"))
        .ok_or("no video stream")?;
    let has_audio = streams
        .iter()
        .any(|s| s.get("codec_type").and_then(|t| t.as_str()) == Some("audio"));

    let rotation = vstream
        .get("side_data_list")
        .and_then(|l| l.as_array())
        .and_then(|l| {
            l.iter().find_map(|sd| {
                sd.get("rotation")
                    .and_then(|r| r.as_i64())
                    .or_else(|| sd.get("rotation").and_then(|r| r.as_str()?.parse().ok()))
            })
        })
        .or_else(|| {
            vstream
                .get("tags")
                .and_then(|t| t.get("rotate"))
                .and_then(|r| r.as_str())
                .and_then(|r| r.parse().ok())
        })
        .unwrap_or(0) as i32;

    let (mut width, mut height) = (
        vstream.get("width").and_then(|w| w.as_u64()).unwrap_or(0) as u32,
        vstream.get("height").and_then(|h| h.as_u64()).unwrap_or(0) as u32,
    );
    if rotation.abs() == 90 || rotation.abs() == 270 {
        std::mem::swap(&mut width, &mut height);
    }

    let fps = vstream
        .get("avg_frame_rate")
        .or_else(|| vstream.get("r_frame_rate"))
        .and_then(|r| r.as_str())
        .and_then(parse_ratio)
        .unwrap_or(0.0);

    let duration_ms = v
        .get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|d| d.as_str())
        .and_then(|d| d.parse::<f64>().ok())
        .map(|s| (s * 1000.0) as i64)
        .or_else(|| {
            vstream
                .get("duration")
                .and_then(|d| d.as_str())
                .and_then(|d| d.parse::<f64>().ok())
                .map(|s| (s * 1000.0) as i64)
        })
        .unwrap_or(0);

    let bitrate_kbps = v
        .get("format")
        .and_then(|f| f.get("bit_rate"))
        .and_then(|b| b.as_str())
        .and_then(|b| b.parse::<u64>().ok())
        .map(|b| (b / 1000) as u32);

    Ok(VideoMeta {
        duration_ms,
        width,
        height,
        fps,
        codec: vstream
            .get("codec_name")
            .and_then(|c| c.as_str())
            .unwrap_or("unknown")
            .to_string(),
        container: v
            .get("format")
            .and_then(|f| f.get("format_name"))
            .and_then(|n| n.as_str())
            .unwrap_or("unknown")
            .to_string(),
        bitrate_kbps,
        rotation_deg: rotation,
        has_audio,
        pix_fmt: vstream
            .get("pix_fmt")
            .and_then(|p| p.as_str())
            .map(|s| s.to_string()),
    })
}

fn parse_ratio(r: &str) -> Option<f64> {
    let mut it = r.split('/');
    let n: f64 = it.next()?.trim().parse().ok()?;
    let d: f64 = it.next().unwrap_or("1").trim().parse().ok()?;
    if d == 0.0 {
        return None;
    }
    Some(n / d)
}

/// Extracts one frame to `out` (png), scaled to `target_w` px wide keeping
/// aspect. `seek_s` positions before `-i` (fast keyframe seek).
pub fn thumbnail(path: &Path, out: &Path, seek_s: f64, target_w: u32) -> Result<(), FfmpegError> {
    let status = Command::new(ffmpeg()?)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            &format!("{seek_s:.3}"),
            "-i",
        ])
        .arg(path)
        .args([
            "-frames:v",
            "1",
            "-vf",
            &format!("scale={target_w}:-2"),
            "-y",
        ])
        .arg(out)
        .output()
        .map_err(|e| FfmpegError::Spawn {
            tool: "ffmpeg",
            source: e,
        })?;
    if !status.status.success() {
        return Err(FfmpegError::Process {
            tool: "ffmpeg",
            code: status.status.code(),
            detail: tail(&status.stderr),
        });
    }
    if !out.is_file() {
        return Err(FfmpegError::Process {
            tool: "ffmpeg",
            code: status.status.code(),
            detail: "ffmpeg reported success but wrote no output".into(),
        });
    }
    Ok(())
}

/// True when WebView2 can decode the stream natively (h264/aac in mp4/mov,
/// vp8/vp9+vorbis/opus in webm). Everything else needs a preview proxy.
pub fn webview_compatible(meta: &VideoMeta) -> bool {
    let c = meta.container.as_str();
    let v = meta.codec.to_ascii_lowercase();
    if c.contains("matroska") || c.contains("webm") {
        return matches!(v.as_str(), "vp8" | "vp9" | "av1");
    }
    if c.contains("mov") || c.contains("mp4") || c.contains("3gp") || c.contains("mj2") {
        return v == "h264" || v == "avc1";
    }
    false
}

/// Transcodes `path` into a small H.264/AAC mp4 preview proxy at `out`
/// (≤1280px wide). The original file is never modified; export still uses it.
pub fn preview_proxy(path: &Path, out: &Path) -> Result<(), FfmpegError> {
    let status = Command::new(ffmpeg()?)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
        ])
        .arg(path)
        .args([
            "-vf",
            "scale='min(1280,iw)':-2",
            "-c:v",
            "libopenh264",
            "-b:v",
            "1500k",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
        ])
        .arg(out)
        .output()
        .map_err(|e| FfmpegError::Spawn {
            tool: "ffmpeg",
            source: e,
        })?;
    if !status.status.success() {
        return Err(FfmpegError::Process {
            tool: "ffmpeg",
            code: status.status.code(),
            detail: tail(&status.stderr),
        });
    }
    if !out.is_file() {
        return Err(FfmpegError::Process {
            tool: "ffmpeg",
            code: status.status.code(),
            detail: "ffmpeg reported success but wrote no proxy".into(),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Repo-root path for generated fixtures (scripts/make-fixtures.ps1).
    fn fixture(name: &str) -> Option<PathBuf> {
        let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        dir.pop(); // crates/
        dir.pop(); // repo root
        let p = dir.join("tests").join("fixtures").join("videos").join(name);
        p.is_file().then_some(p)
    }

    #[test]
    fn probes_and_thumbnails_real_fixtures() {
        let Some(path) = fixture("landscape_1080p_30.mp4") else {
            eprintln!("fixture missing — skipping (run scripts/make-fixtures.ps1)");
            return;
        };
        if crate::ffmpeg().is_err() {
            eprintln!("vendored ffmpeg missing — skipping");
            return;
        }
        let r = probe(&path);
        let m = r.meta.expect("real fixture must probe");
        assert_eq!((m.width, m.height), (1920, 1080));
        assert_eq!(m.codec, "h264");
        assert!(m.has_audio);
        assert!(m.duration_ms > 2500 && m.duration_ms < 3500, "{}", m.duration_ms);

        let dir = tempfile::tempdir().unwrap();
        let tmp = dir.path().join("t.png");
        thumbnail(&path, &tmp, 1.0, 320).unwrap();
        assert!(tmp.metadata().unwrap().len() > 1000);
    }

    #[test]
    fn parses_typical_ffprobe_json() {
        let v = json!({
            "streams": [
                {
                    "codec_type": "video", "codec_name": "h264",
                    "width": 1920, "height": 1080, "pix_fmt": "yuv420p",
                    "avg_frame_rate": "30000/1001",
                    "side_data_list": [{"rotation": 0}]
                },
                {"codec_type": "audio", "codec_name": "aac"}
            ],
            "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "10.5", "bit_rate": "2500000"}
        });
        let m = parse_probe(&v).unwrap();
        assert_eq!((m.width, m.height), (1920, 1080));
        assert!((m.fps - 29.97).abs() < 0.01);
        assert_eq!(m.duration_ms, 10500);
        assert_eq!(m.bitrate_kbps, Some(2500));
        assert!(m.has_audio);
        assert_eq!(m.codec, "h264");
    }

    #[test]
    fn rotation_swaps_dimensions() {
        let v = json!({
            "streams": [{"codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080,
                "avg_frame_rate": "30/1", "tags": {"rotate": "90"}}],
            "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "5"}
        });
        let m = parse_probe(&v).unwrap();
        assert_eq!((m.width, m.height), (1080, 1920));
        assert_eq!(m.rotation_deg, 90);
        assert!(!m.has_audio);
    }

    #[test]
    fn no_video_stream_is_error() {
        let v = json!({"streams": [{"codec_type": "audio"}], "format": {}});
        assert!(parse_probe(&v).is_err());
    }

    #[test]
    fn zero_denominator_fps_is_zero() {
        assert_eq!(parse_ratio("0/0"), None);
        assert_eq!(parse_ratio("25/1"), Some(25.0));
    }
}
