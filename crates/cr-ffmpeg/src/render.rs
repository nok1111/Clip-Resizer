//! Render engine: RenderSpec → deterministic FFmpeg argv, run with real
//! progress (`-progress pipe:`), cooperative cancel ('q' then kill), and
//! post-render verification via ffprobe.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};

use cr_model::{
    AudioMode, Background, Canvas, FitSpec, QualityPreset, RenderSpec, VideoCodec, VideoMeta,
};

use crate::{tail, FfmpegError};

// ── Encoder capability matrix ───────────────────────────────────────────────

/// Encoder names present in the vendored ffmpeg, parsed once from
/// `ffmpeg -hide_banner -encoders`.
pub fn encoders() -> Result<Vec<String>, FfmpegError> {
    let out = Command::new(crate::ffmpeg()?)
        .args(["-hide_banner", "-encoders"])
        .output()
        .map_err(|e| FfmpegError::Spawn {
            tool: "ffmpeg",
            source: e,
        })?;
    if !out.status.success() {
        return Err(FfmpegError::Process {
            tool: "ffmpeg",
            code: out.status.code(),
            detail: tail(&out.stderr),
        });
    }
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(text
        .lines()
        .filter_map(|l| {
            let l = l.trim_start();
            if l.starts_with('V') {
                l.split_whitespace().nth(1).map(|s| s.to_string())
            } else {
                None
            }
        })
        .collect())
}

/// Priority order per codec: hardware first (fast + patent-clean), then
/// Media Foundation (universal Win10/11 baseline), then software fallback.
const H264_ORDER: &[&str] = &[
    "h264_nvenc",
    "h264_qsv",
    "h264_amf",
    "h264_mf",
    "libopenh264",
];
const HEVC_ORDER: &[&str] = &[
    "hevc_nvenc",
    "hevc_qsv",
    "hevc_amf",
    "hevc_mf",
    "libkvazaar",
];

pub fn pick_encoder(codec: VideoCodec, available: &[String]) -> Option<String> {
    let order = match codec {
        VideoCodec::H264 => H264_ORDER,
        VideoCodec::H265 => HEVC_ORDER,
    };
    order
        .iter()
        .find(|e| available.iter().any(|a| a == *e))
        .map(|s| s.to_string())
}

// ── Filtergraph ─────────────────────────────────────────────────────────────

/// Video filter chain for the spec, given the source display dimensions.
/// Ends with setsar=1 so outputs never carry odd sample aspect.
pub fn filtergraph(spec: &RenderSpec, src_w: u32, src_h: u32) -> String {
    let Canvas { width: w, height: h } = spec.canvas;
    let mut v = String::new();
    match spec.fit {
        FitSpec::Fill {
            offset_x,
            offset_y,
            zoom,
        } => {
            // Cover scale: the crop window is canvas-sized inside a frame
            // scaled up so it covers; offsets pan within the slack.
            // crop=w:h:x:y on the scaled frame is the robust classic recipe.
            let cover = format!(
                "scale={w}:{h}:force_original_aspect_ratio=increase:flags=lanczos"
            );
            let zoom = zoom.max(1.0);
            v.push_str(&cover);
            v.push_str(&format!(",scale=trunc(iw*{zoom}/2)*2:trunc(ih*{zoom}/2)*2"));
            // crop slack: (iw-w)/2 ± offset*slack
            v.push_str(&format!(
                ",crop={w}:{h}:x='(iw-{w})/2{}':y='(ih-{h})/2{}'",
                signed_mul(clamp01(offset_x), &format!("(iw-{w})/2")),
                signed_mul(clamp01(offset_y), &format!("(ih-{h})/2")),
            ));
        }
        FitSpec::Fit => {
            // Foreground box: canvas minus margin (each side), keeping aspect.
            let m = spec.margin.clamp(0.0, 0.4);
            let (bw, border) = &spec.border;
            // Foreground box = canvas minus margin per side (even dims).
            let iw2 = ((w as f64 * (1.0 - 2.0 * m)) as u32) & !1;
            let ih2 = ((h as f64 * (1.0 - 2.0 * m)) as u32) & !1;
            let inner = format!("{iw2}:{ih2}");
            let borderpad = if *bw > 0.0 {
                format!(",pad=iw+{b}:ih+{b}:(ow-iw)/2:(oh-ih)/2:{border}", b = (2.0 * *bw) as i32)
            } else {
                String::new()
            };
            let fgscale = |tag: &str| {
                format!("scale={inner}:force_original_aspect_ratio=decrease:flags=lanczos{borderpad}{tag}")
            };
            match &spec.background {
                Background::Solid { color } => {
                    v.push_str(&format!(
                        "{fg},pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:{color}",
                        fg = fgscale(""),
                    ));
                }
                Background::Blur { sigma, dim } => {
                    let lum = 1.0 - dim.clamp(0.0, 0.95);
                    // lutyuv replaces eq (GPL-only filter, absent in LGPL builds)
                    v.push_str(&format!(
                        "split[fg][bg];\
                         [bg]scale={w}:{h}:force_original_aspect_ratio=increase:flags=lanczos,\
                         crop={w}:{h},gblur=sigma={sigma},lutyuv=y='val*{lum}'[bg2];\
                         [fg]{fg}[fg2];\
                         [bg2][fg2]overlay=(W-w)/2:(H-h)/2",
                        fg = fgscale(""),
                    ));
                }
                Background::Image { blur, .. } => {
                    // Input 1 is the still; loop it as a video stream.
                    let gb = if *blur > 0.0 { format!(",gblur=sigma={blur}") } else { String::new() };
                    v.push_str(&format!(
                        "[1:v]scale={w}:{h}:force_original_aspect_ratio=increase:flags=lanczos,\
                         crop={w}:{h}{gb}[bg2];\
                         [0:v]{fg}[fg2];\
                         [bg2][fg2]overlay=(W-w)/2:(H-h)/2",
                        fg = fgscale(""),
                    ));
                }
            }
        }
    }
    let _ = (src_w, src_h); // geometry is computed by ffmpeg expressions
    // No fps filter when keeping the source rate — it would be a no-op
    // anyway (and "source" is not a valid fps constant).
    if let Some(fps) = spec.export.fps {
        v.push_str(&format!(",fps=fps={}", fmt_fps(fps)));
    }
    v.push_str(",setsar=1,format=yuv420p");
    v
}

fn clamp01(v: f64) -> f64 {
    v.clamp(-1.0, 1.0)
}

/// `+v*expr` / `-|v|*expr` — sign-aware so ffmpeg never sees `+-`.
fn signed_mul(v: f64, expr: &str) -> String {
    if v < 0.0 {
        format!("-{}*{}", -v, expr)
    } else {
        format!("+{}*{}", v, expr)
    }
}

fn fmt_fps(f: f64) -> String {
    if f.fract() == 0.0 {
        format!("{}", f as u32)
    } else {
        format!("{f:.3}")
    }
}

// ── Bitrate / quality mapping ───────────────────────────────────────────────

/// Target bitrate (kbps) for canvas+fps: bits-per-pixel heuristic, honest
/// CBR for hardware encoders that lack a real CRF.
pub fn bitrate_kbps(spec: &RenderSpec, fps: f64) -> u64 {
    let Canvas { width, height } = spec.canvas;
    let bpp = match spec.export.quality {
        QualityPreset::Fast => 0.05,
        QualityPreset::Balanced => 0.08,
        QualityPreset::High => 0.14,
    };
    let codec_factor = match spec.export.codec {
        VideoCodec::H264 => 1.0,
        VideoCodec::H265 => 0.6,
    };
    let fps = if fps > 0.0 { fps } else { 30.0 };
    let kbps = (width as f64 * height as f64 * fps * bpp * codec_factor) / 1000.0;
    (kbps as u64).clamp(400, 80_000)
}

/// Encoder-specific args after `-c:v`. Quality is mapped per encoder
/// family; unknown names fall back to plain bitrate.
pub fn encoder_args(encoder: &str, spec: &RenderSpec, fps: f64) -> Vec<String> {
    let br = bitrate_kbps(spec, fps);
    let mut a = vec!["-c:v".into(), encoder.to_string()];
    match encoder {
        e if e.ends_with("_mf") => {
            a.extend(["-rate_control".into(), "cbr".into(), "-b:v".into(), format!("{br}k")]);
        }
        e if e.ends_with("_nvenc") => {
            let cq = match spec.export.quality {
                QualityPreset::Fast => "30",
                QualityPreset::Balanced => "24",
                QualityPreset::High => "18",
            };
            a.extend(["-preset".into(), "p5".into(), "-cq".into(), cq.into()]);
        }
        e if e.ends_with("_qsv") || e.ends_with("_amf") => {
            a.extend(["-b:v".into(), format!("{br}k")]);
        }
        "libopenh264" | "libkvazaar" => {
            a.extend(["-b:v".into(), format!("{br}k")]);
        }
        _ => {
            a.extend(["-b:v".into(), format!("{br}k")]);
        }
    }
    a
}

/// Full argv for a render (input → temp output path).
pub fn build_args(
    spec: &RenderSpec,
    meta: &VideoMeta,
    encoder: &str,
    output: &Path,
) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-nostats".into(),
        "-progress".into(),
        "pipe:1".into(),
        "-y".into(),
        "-i".into(),
        spec.input.clone(),
    ];
    // Second input: the background still (looped for the whole duration).
    if let FitSpec::Fit = spec.fit {
        if let Background::Image { path, .. } = &spec.background {
            args.extend(["-loop".into(), "1".into(), "-i".into(), path.clone()]);
        }
    }
    args.extend([
        "-filter_complex".into(),
        filtergraph(spec, meta.width, meta.height),
    ]);
    let fps = spec.export.fps.unwrap_or(meta.fps);
    args.extend(encoder_args(encoder, spec, fps));
    match spec.export.audio {
        AudioMode::Copy => {
            if meta.has_audio {
                args.extend(["-c:a".into(), "copy".into()]);
            } else {
                args.push("-an".into());
            }
        }
        AudioMode::Aac => {
            if meta.has_audio {
                args.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "192k".into()]);
            } else {
                args.push("-an".into());
            }
        }
        AudioMode::Remove => args.push("-an".into()),
    }
    args.extend([
        "-movflags".into(),
        "+faststart".into(),
        "-f".into(),
        "mp4".into(),
    ]);
    args.push(output.to_string_lossy().into_owned());
    args
}

// ── Runner ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default)]
pub struct Progress {
    /// 0..1 processed fraction of the source duration.
    pub frac: f64,
    pub out_s: f64,
    pub speed: f64,
    pub size: u64,
    /// `progress=end` was emitted.
    pub finished: bool,
}

/// Spawns ffmpeg for `spec` → `output`. Calls `on_progress` with parsed
/// progress (caller throttles). Checks `cancel` between lines: sends 'q',
/// kills after a short grace.
pub fn run_render(
    spec: &RenderSpec,
    meta: &VideoMeta,
    encoder: &str,
    output: &Path,
    cancel: &AtomicBool,
    on_progress: impl Fn(Progress),
    mut on_spawn: impl FnMut(&mut Child),
) -> Result<(), FfmpegError> {
    let args = build_args(spec, meta, encoder, output);
    let mut child = Command::new(crate::ffmpeg()?)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| FfmpegError::Spawn {
            tool: "ffmpeg",
            source: e,
        })?;
    on_spawn(&mut child);

    let mut stdin = child.stdin.take().expect("piped stdin");
    let stdout = child.stdout.take().expect("piped stdout");
    // stderr → ring buffer thread (diagnostic tail on failure).
    let stderr = child.stderr.take().expect("piped stderr");
    let tail_buf = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    {
        let tail_buf = tail_buf.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut line = Vec::new();
            let mut buf = [0u8; 512];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        line.extend_from_slice(&buf[..n]);
                        while let Some(pos) = line.iter().position(|&b| b == b'\n') {
                            let l: Vec<u8> = line.drain(..=pos).collect();
                            let s = String::from_utf8_lossy(&l).trim().to_string();
                            if !s.is_empty() {
                                let mut g = tail_buf.lock().unwrap();
                                g.push(s);
                                if g.len() > 120 {
                                    g.remove(0);
                                }
                            }
                        }
                    }
                }
            }
        });
    }

    let dur_s = meta.duration_ms.max(0) as f64 / 1000.0;
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let mut p = Progress::default();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let l = line.trim();
                if let Some(v) = l.strip_prefix("out_time_us=") {
                    let us: f64 = v.parse().unwrap_or(0.0);
                    p.out_s = us / 1_000_000.0;
                    if dur_s > 0.0 {
                        p.frac = (p.out_s / dur_s).clamp(0.0, 1.0);
                    }
                } else if let Some(v) = l.strip_prefix("out_time_ms=") {
                    let us: f64 = v.parse().unwrap_or(0.0);
                    p.out_s = us / 1_000_000.0;
                    if dur_s > 0.0 {
                        p.frac = (p.out_s / dur_s).clamp(0.0, 1.0);
                    }
                } else if let Some(v) = l.strip_prefix("total_size=") {
                    p.size = v.parse().unwrap_or(0);
                } else if let Some(v) = l.strip_prefix("speed=") {
                    p.speed = v.trim_end_matches('x').parse().unwrap_or(0.0);
                } else if l == "progress=continue" {
                    on_progress(p.clone());
                } else if l == "progress=end" {
                    p.finished = true;
                    on_progress(p.clone());
                    break;
                }
            }
            Err(_) => break,
        }
        if cancel.load(Ordering::Relaxed) {
            let _ = stdin.write_all(b"q\n");
            let _ = stdin.flush();
            // Grace: 'q' usually exits cleanly within a second; force-kill
            // on the next loop iteration if the stream stops responding.
            let grace_start = std::time::Instant::now();
            while child.try_wait().ok().flatten().is_none()
                && grace_start.elapsed() < std::time::Duration::from_secs(2)
            {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            if child.try_wait().ok().flatten().is_none() {
                let _ = child.kill();
            }
            let _ = child.wait();
            return Err(FfmpegError::Process {
                tool: "ffmpeg",
                code: None,
                detail: "cancelled".into(),
            });
        }
    }

    let status = child.wait().map_err(FfmpegError::Io)?;
    if !status.success() {
        let detail = tail_buf.lock().unwrap().join("\n");
        return Err(FfmpegError::Process {
            tool: "ffmpeg",
            code: status.code(),
            detail,
        });
    }
    if !output.is_file() {
        return Err(FfmpegError::Process {
            tool: "ffmpeg",
            code: status.code(),
            detail: "ffmpeg exited ok but wrote no output".into(),
        });
    }
    Ok(())
}

// ── Verification ────────────────────────────────────────────────────────────

/// Post-render check: the output probes, has a video stream with the exact
/// canvas geometry, non-trivial size, and duration within tolerance.
pub fn verify_output(path: &Path, canvas: Canvas, expected_dur_ms: i64) -> Result<(), FfmpegError> {
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if size < 1024 {
        return Err(FfmpegError::Parse(format!(
            "output too small ({size} bytes): {}",
            path.display()
        )));
    }
    let r = crate::probe(path);
    let Some(meta) = r.meta else {
        return Err(FfmpegError::Parse(format!(
            "output failed ffprobe: {}",
            r.error.map(|e| e.message).unwrap_or_default()
        )));
    };
    if meta.width != canvas.width || meta.height != canvas.height {
        return Err(FfmpegError::Parse(format!(
            "output geometry {}x{} != canvas {}x{}",
            meta.width, meta.height, canvas.width, canvas.height
        )));
    }
    if expected_dur_ms > 0 && meta.duration_ms > 0 {
        let drift = (meta.duration_ms - expected_dur_ms).abs() as f64;
        let tol = (expected_dur_ms as f64 * 0.05).max(1500.0);
        if drift > tol {
            return Err(FfmpegError::Parse(format!(
                "output duration {}ms vs expected {}ms",
                meta.duration_ms, expected_dur_ms
            )));
        }
    }
    Ok(())
}

/// Renders a single frame through the real filtergraph (preview honesty).
pub fn preview_frame(
    spec: &RenderSpec,
    meta: &VideoMeta,
    t_s: f64,
    out: &Path,
) -> Result<(), FfmpegError> {
    let mut cmd = Command::new(crate::ffmpeg()?);
    cmd.args([
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-ss".into(),
        format!("{t_s:.3}"),
        "-i".into(),
        spec.input.clone(),
    ]);
    if let FitSpec::Fit = spec.fit {
        if let Background::Image { path, .. } = &spec.background {
            cmd.args(["-loop".into(), "1".into(), "-i".into(), path.clone()]);
        }
    }
    cmd.args([
        "-filter_complex".into(),
        filtergraph(spec, meta.width, meta.height),
        "-frames:v".into(),
        "1".into(),
        "-y".into(),
    ]);
    let status = cmd
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
        return Err(FfmpegError::Parse("preview frame not written".into()));
    }
    Ok(())
}

// ── Output path / conflict resolution ───────────────────────────────────────

/// Resolves the final output path under `dir` applying the conflict policy.
/// Returns None when policy is Skip and the name exists.
pub fn resolve_output(
    dir: &Path,
    input: &Path,
    canvas: Canvas,
    conflict: cr_model::ConflictPolicy,
) -> Option<PathBuf> {
    let stem = input
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "video".into());
    let name = |suffix: &str| {
        dir.join(format!(
            "{stem}{}_{}x{}.mp4",
            suffix, canvas.width, canvas.height
        ))
    };
    let base = name("");
    let input = input.canonicalize().unwrap_or_else(|_| input.to_path_buf());
    let exists = |p: &Path| p.canonicalize().ok().is_some_and(|c| c.exists());
    let same_as_input = |p: &Path| p.canonicalize().ok() == Some(input.clone());
    if !exists(&base) && !same_as_input(&base) {
        return Some(base);
    }
    match conflict {
        cr_model::ConflictPolicy::Skip => None,
        cr_model::ConflictPolicy::Overwrite if !same_as_input(&base) => Some(base),
        _ => {
            for i in 2..1000 {
                let p = name(&format!(" ({i})"));
                if !exists(&p) && !same_as_input(&p) {
                    return Some(p);
                }
            }
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cr_model::ExportSpec;

    fn spec(fit: FitSpec, bg: Background) -> RenderSpec {
        RenderSpec {
            input: "in.mp4".into(),
            canvas: Canvas {
                width: 1080,
                height: 1920,
            },
            fit,
            background: bg,
            margin: 0.0,
            border: (0.0, "#ffffff".into()),
            export: ExportSpec {
                codec: VideoCodec::H264,
                quality: QualityPreset::Balanced,
                fps: None,
                audio: AudioMode::Copy,
            },
        }
    }

    fn meta() -> VideoMeta {
        VideoMeta {
            duration_ms: 60_000,
            width: 1920,
            height: 1080,
            fps: 30.0,
            codec: "h264".into(),
            container: "mov,mp4,m4a,3gp,3g2,mj2".into(),
            bitrate_kbps: Some(8000),
            rotation_deg: 0,
            has_audio: true,
            pix_fmt: Some("yuv420p".into()),
        }
    }

    #[test]
    fn fill_graph_scales_covers_and_crops() {
        let g = filtergraph(
            &spec(
                FitSpec::Fill {
                    offset_x: 0.0,
                    offset_y: 0.0,
                    zoom: 1.0,
                },
                Background::Solid {
                    color: "#000000".into(),
                },
            ),
            1920,
            1080,
        );
        assert!(g.contains("force_original_aspect_ratio=increase"));
        assert!(g.contains("crop=1080:1920"));
        assert!(g.ends_with("format=yuv420p"));
        assert!(!g.contains("fps=")); // source fps → no fps filter
    }

    #[test]
    fn fit_solid_graph_letterboxes() {
        let g = filtergraph(
            &spec(FitSpec::Fit, Background::Solid {
                color: "#101418".into(),
            }),
            1920,
            1080,
        );
        assert!(g.contains("force_original_aspect_ratio=decrease"));
        assert!(g.contains("pad=1080:1920"));
        assert!(g.contains("#101418"));
    }

    #[test]
    fn fit_blur_graph_splits_and_overlays() {
        let g = filtergraph(
            &spec(FitSpec::Fit, Background::Blur {
                sigma: 20.0,
                dim: 0.4,
            }),
            1920,
            1080,
        );
        for part in ["split[fg][bg]", "gblur=sigma=20", "lutyuv=y='val*0.6'", "overlay=(W-w)/2"] {
            assert!(g.contains(part), "missing {part} in {g}");
        }
    }

    #[test]
    fn offsets_clamp_into_crop_expressions() {
        let g = filtergraph(
            &spec(
                FitSpec::Fill {
                    offset_x: 2.0,
                    offset_y: -5.0,
                    zoom: 1.5,
                },
                Background::Solid {
                    color: "#000000".into(),
                },
            ),
            1920,
            1080,
        );
        assert!(g.contains("+1*(iw-1080)/2"), "{g}");
        assert!(g.contains("-1*(ih-1920)/2"), "{g}");
    }

    #[test]
    fn encoder_matrix_prefers_hw_then_mf_then_sw() {
        let only_mf = vec!["h264_mf".to_string(), "libopenh264".to_string()];
        assert_eq!(pick_encoder(VideoCodec::H264, &only_mf).as_deref(), Some("h264_mf"));
        let only_sw = vec!["libopenh264".to_string()];
        assert_eq!(
            pick_encoder(VideoCodec::H264, &only_sw).as_deref(),
            Some("libopenh264")
        );
        assert_eq!(pick_encoder(VideoCodec::H264, &[]), None);
        let kvz = vec!["libkvazaar".to_string()];
        assert_eq!(
            pick_encoder(VideoCodec::H265, &kvz).as_deref(),
            Some("libkvazaar")
        );
    }

    #[test]
    fn bitrate_scales_with_area_fps_and_quality() {
        let mut s = spec(FitSpec::Fit, Background::Solid { color: "#000".into() });
        let b1080 = bitrate_kbps(&s, 30.0);
        s.canvas = Canvas { width: 720, height: 1280 };
        assert!(bitrate_kbps(&s, 30.0) < b1080);
        s.canvas = Canvas { width: 1080, height: 1920 };
        s.export.quality = QualityPreset::High;
        assert!(bitrate_kbps(&s, 30.0) > b1080);
    }

    #[test]
    fn args_have_progress_pipe_and_faststart() {
        let a = build_args(
            &spec(FitSpec::Fit, Background::Solid { color: "#000".into() }),
            &meta(),
            "h264_mf",
            Path::new("out.mp4"),
        );
        let joined = a.join(" ");
        assert!(joined.contains("-progress pipe:1"));
        assert!(joined.contains("+faststart"));
        assert!(joined.contains("-c:v h264_mf"));
        assert!(joined.contains("-c:a copy"));
    }

    #[test]
    fn conflict_resolution_renames_and_never_touches_input() {
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("clip.mp4");
        std::fs::write(&input, b"x").unwrap();
        let canvas = Canvas { width: 1080, height: 1920 };
        // Name collides with an existing output → rename to (2).
        let taken = dir.path().join("clip_1080x1920.mp4");
        std::fs::write(&taken, b"x").unwrap();
        let p = resolve_output(dir.path(), &input, canvas, cr_model::ConflictPolicy::Rename).unwrap();
        assert!(p.to_string_lossy().contains("(2)"));
        // Skip → None.
        assert_eq!(
            resolve_output(dir.path(), &input, canvas, cr_model::ConflictPolicy::Skip),
            None
        );
        // Input path itself is never returned.
        let p2 = resolve_output(dir.path(), &taken, canvas, cr_model::ConflictPolicy::Overwrite);
        assert_ne!(
            p2.map(|x| x.canonicalize().unwrap_or(x)),
            Some(taken.canonicalize().unwrap())
        );
    }
}
