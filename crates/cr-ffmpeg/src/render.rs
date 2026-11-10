//! Render engine: RenderSpec → deterministic FFmpeg argv, run with real
//! progress (`-progress pipe:`), cooperative cancel ('q' then kill), and
//! post-render verification via ffprobe.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

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

fn order(codec: VideoCodec) -> &'static [&'static str] {
    match codec {
        VideoCodec::H264 => H264_ORDER,
        VideoCodec::H265 => HEVC_ORDER,
    }
}

pub fn pick_encoder(codec: VideoCodec, available: &[String]) -> Option<String> {
    order(codec)
        .iter()
        .find(|e| available.iter().any(|a| a == *e))
        .map(|s| s.to_string())
}

/// Listed encoders for `codec`, in priority order, that actually open on
/// this machine. A build lists hardware encoders whose GPU/driver may be
/// missing (e.g. nvenc on an AMD box), so each is test-encoded once.
pub fn working_encoders(codec: VideoCodec, available: &[String]) -> Vec<String> {
    order(codec)
        .iter()
        .filter(|e| available.iter().any(|a| a == *e) && encoder_works(e))
        .map(|s| s.to_string())
        .collect()
}

pub fn pick_working_encoder(codec: VideoCodec, available: &[String]) -> Option<String> {
    working_encoders(codec, available).into_iter().next()
}

fn encoder_cache() -> &'static Mutex<HashMap<String, bool>> {
    static CACHE: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

/// One-frame null encode; cached for the process lifetime.
pub fn encoder_works(encoder: &str) -> bool {
    if let Some(&ok) = encoder_cache().lock().ok().as_ref().and_then(|c| c.get(encoder)) {
        return ok;
    }
    let ok = crate::ffmpeg().is_ok_and(|bin| {
        Command::new(bin)
            .args([
                "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                "color=s=256x256:d=0.1:r=10", "-frames:v", "1", "-c:v", encoder, "-f", "null", "-",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
    });
    if let Ok(mut c) = encoder_cache().lock() {
        c.insert(encoder.to_string(), ok);
    }
    ok
}

/// A render failed because the encoder could not start (not the graph):
/// skip it from now on so the caller can retry with the next candidate.
pub fn encoder_failed_to_open(encoder: &str, err: &FfmpegError) -> bool {
    let msg = err.to_string();
    let open_failure = ["opening encoder", "Could not open encoder", "Cannot load", "No capable devices"]
        .iter()
        .any(|m| msg.contains(m));
    if open_failure {
        if let Ok(mut c) = encoder_cache().lock() {
            c.insert(encoder.to_string(), false);
        }
    }
    open_failure
}

// ── Filtergraph ─────────────────────────────────────────────────────────────

/// Video filter chain for the spec, given the source display dimensions.
/// Ends with setsar=1 so outputs never carry odd sample aspect.
pub fn filtergraph(spec: &RenderSpec, src_w: u32, src_h: u32) -> String {
    let Canvas { width: w, .. } = spec.canvas;
    let mut v = String::new();
    let (src_w, src_h) = if spec.rotate % 180 == 90 {
        (src_h, src_w)
    } else {
        (src_w, src_h)
    };
    v.push_str(&compose(spec, src_w, src_h));
    // Picture-in-picture overlay: input index 2 when an image bg exists.
    if let Some(ov) = &spec.overlay {
        let img_bg = matches!(spec.background, Background::Image { .. });
        let oi = if img_bg { 2 } else { 1 };
        let wf = ov.scale.clamp(0.05, 1.0);
        let px = (1.0 + ov.offset_x.clamp(-1.0, 1.0)) / 2.0;
        let py = (1.0 + ov.offset_y.clamp(-1.0, 1.0)) / 2.0;
        v.push_str("[base]");
        v.push_str(&format!(
            ";[{oi}:v]scale=trunc({w}*{wf:.4}/2)*2:-2,format=yuv420p[ovr];\
             [base][ovr]overlay='(W-w)*{px:.4}':'(H-h)*{py:.4}'"
        ));
    }
    // Watermark: still image with opacity, composited last (topmost).
    if let Some(wm) = &spec.watermark {
        let mut idx = 1usize;
        if matches!(spec.background, Background::Image { .. }) {
            idx += 1;
        }
        if spec.overlay.is_some() {
            idx += 1;
        }
        let wf = wm.scale.clamp(0.02, 1.0);
        let px = (1.0 + wm.offset_x.clamp(-1.0, 1.0)) / 2.0;
        let py = (1.0 + wm.offset_y.clamp(-1.0, 1.0)) / 2.0;
        let op = wm.opacity.clamp(0.0, 1.0);
        v.push_str("[wmb]");
        v.push_str(&format!(
            ";[{idx}:v]scale=trunc({w}*{wf:.4}/2)*2:-2,format=rgba,\
             colorchannelmixer=aa={op:.3}[wml];\
             [wmb][wml]overlay='(W-w)*{px:.4}':'(H-h)*{py:.4}'"
        ));
    }
    // No fps filter when keeping the source rate — it would be a no-op
    // anyway (and "source" is not a valid fps constant).
    if let Some(fps) = spec.export.fps {
        v.push_str(&format!(",fps=fps={}", fmt_fps(fps)));
    }
    // Burned-in guides (opt-in; drawbox is in the LGPL filter set).
    let g = spec.guides;
    let gc = "yellow@0.7";
    if g.export && g.safe {
        v.push_str(&format!(",drawbox=x=w*0.05:y=h*0.05:w=w*0.9:h=h*0.9:color={gc}:t=2"));
    }
    if g.export && g.thirds {
        for x in ["w/3", "2*w/3"] {
            v.push_str(&format!(",drawbox=x={x}:y=0:w=2:h=ih:color={gc}:t=fill"));
        }
        for y in ["h/3", "2*h/3"] {
            v.push_str(&format!(",drawbox=x=0:y={y}:w=iw:h=2:color={gc}:t=fill"));
        }
    }
    if g.export && g.center {
        v.push_str(&format!(",drawbox=x=(iw-24)/2:y=ih/2-1:w=24:h=2:color={gc}:t=fill"));
        v.push_str(&format!(",drawbox=x=iw/2-1:y=(ih-24)/2:w=2:h=24:color={gc}:t=fill"));
    }
    v.push_str(",setsar=1,format=yuv420p");
    v
}

/// Foreground placement on the canvas in output pixels (post-rotation).
/// Single source of truth for the framing math — the preview mirrors it in
/// `src/lib/framing.ts`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Placement {
    /// Video content (border excluded): top-left corner and size.
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    /// Output pixels per source pixel.
    pub scale: f64,
    /// Border thickness drawn around the content (0 when not framed).
    pub border: f64,
}

/// Where the fg lands for `spec`, given post-rotation source dims.
pub fn placement(spec: &RenderSpec, src_w: u32, src_h: u32) -> Placement {
    let cw = spec.canvas.width as f64;
    let ch = spec.canvas.height as f64;
    let sw = src_w.max(1) as f64;
    let sh = src_h.max(1) as f64;
    let cover = (cw / sw).max(ch / sh);
    let fit = (cw / sw).min(ch / sh);
    let (scale, framed, ox, oy, px, py) = match spec.fit {
        FitSpec::Fill { offset_x, offset_y, zoom, pan_x, pan_y } => {
            let z = zoom.clamp(0.05, 8.0);
            (cover * z, z < 0.999, offset_x, offset_y, pan_x, pan_y)
        }
        FitSpec::Fit { zoom, offset_x, offset_y, pan_x, pan_y } => {
            let m = spec.margin.clamp(0.0, 0.4);
            let s = fit * (1.0 - 2.0 * m) * zoom.clamp(0.05, 8.0);
            (s, true, offset_x, offset_y, pan_x, pan_y)
        }
    };
    let w = sw * scale;
    let h = sh * scale;
    let border = if framed { spec.border.0.max(0.0) } else { 0.0 };
    let (ow, oh) = (w + 2.0 * border, h + 2.0 * border);
    // pan moves the centre by a canvas fraction; the legacy offset term
    // reproduces the old slack-relative placement (-offset * slack).
    let cx = cw / 2.0 + fin(px).clamp(-4.0, 4.0) * cw - clamp01(fin(ox)) * (ow - cw) / 2.0;
    let cy = ch / 2.0 + fin(py).clamp(-4.0, 4.0) * ch - clamp01(fin(oy)) * (oh - ch) / 2.0;
    // Keep a sliver on-canvas so the graph never gets an empty crop.
    let cx = cx.clamp(4.0 - w / 2.0, cw - 4.0 + w / 2.0);
    let cy = cy.clamp(4.0 - h / 2.0, ch - 4.0 + h / 2.0);
    Placement { x: cx - w / 2.0, y: cy - h / 2.0, w, h, scale, border }
}

fn fin(v: f64) -> f64 {
    if v.is_finite() { v } else { 0.0 }
}

fn even(v: f64) -> i64 {
    ((v / 2.0).round() * 2.0) as i64
}

/// Integer recipe for one axis: crop the source to `[s0, s0+span)`, scale
/// that strip to `t`, trim `inner..inner+len` and place it at `pos`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct AxisPlan {
    s0: u32,
    span: u32,
    t: u32,
    inner: u32,
    len: u32,
    pos: u32,
}

fn axis_plan(x: f64, w: f64, scale: f64, src: u32, canvas: u32) -> AxisPlan {
    let canvas = canvas as i64;
    let v0 = even(x).clamp(0, canvas - 2);
    let v1 = even(x + w).clamp(v0 + 2, canvas);
    let src = src.max(1);
    let s0 = (((v0 as f64 - x) / scale).floor().max(0.0) as u32).min(src - 1);
    let s1 = (((v1 as f64 - x) / scale).ceil().max(0.0) as u32).clamp(s0 + 1, src);
    let span = s1 - s0;
    let len = (v1 - v0) as u32;
    let inner = ((v0 as f64 - x) - s0 as f64 * scale).round().max(0.0) as u32;
    let t = ((span as f64 * scale).round() as u32).max(inner + len).max(1);
    AxisPlan { s0, span, t, inner, len, pos: v0 as u32 }
}

/// Main video chain: fg cropped to its visible window, composited on the
/// background. Cropping the *source* first keeps big zooms cheap (no
/// 8× intermediate frames) and lets the fg sit partially off-canvas.
fn compose(spec: &RenderSpec, src_w: u32, src_h: u32) -> String {
    let Canvas { width: w, height: h } = spec.canvas;
    let mut tf = String::new();
    if spec.flip {
        tf.push_str("hflip,");
    }
    match spec.rotate % 360 {
        90 => tf.push_str("transpose=1,"),
        180 => tf.push_str("transpose=2,transpose=2,"),
        270 => tf.push_str("transpose=2,"),
        _ => {}
    }
    let p = placement(spec, src_w, src_h);
    let ax = axis_plan(p.x, p.w, p.scale, src_w, w);
    let ay = axis_plan(p.y, p.h, p.scale, src_h, h);
    let mut fg = String::new();
    if ax.s0 != 0 || ay.s0 != 0 || ax.span != src_w || ay.span != src_h {
        fg.push_str(&format!("crop={}:{}:{}:{}:exact=1,", ax.span, ay.span, ax.s0, ay.s0));
    }
    fg.push_str(&format!("scale={}:{}:flags=lanczos", ax.t, ay.t));
    if ax.inner != 0 || ay.inner != 0 || ax.len != ax.t || ay.len != ay.t {
        fg.push_str(&format!(",crop={}:{}:{}:{}:exact=1", ax.len, ay.len, ax.inner, ay.inner));
    }
    let covers = ax.pos == 0 && ay.pos == 0 && ax.len == w && ay.len == h;
    let image_bg = matches!(spec.background, Background::Image { .. });
    if covers && !image_bg {
        return format!("{tf}{fg}");
    }
    let (dx, dy) = (ax.pos, ay.pos);
    let mut out = match &spec.background {
        Background::Solid { color } => format!("{tf}{fg},pad={w}:{h}:{dx}:{dy}:{color}"),
        Background::Blur { sigma, dim } => {
            let lum = 1.0 - dim.clamp(0.0, 0.95);
            // lutyuv replaces eq (GPL-only filter, absent in LGPL builds)
            format!(
                "{tf}split[fg][bg];\
                 [bg]scale={w}:{h}:force_original_aspect_ratio=increase:flags=lanczos,\
                 crop={w}:{h},gblur=sigma={sigma},lutyuv=y='val*{lum}'[bg2];\
                 [fg]{fg}[fg2];\
                 [bg2][fg2]overlay={dx}:{dy}"
            )
        }
        Background::Image { blur, dim, zoom, pan_x, pan_y, .. } => {
            // Input 1 is the still; loop it as a video stream. Cover a
            // zoom-scaled canvas, then crop the canvas window at pan.
            let z = if zoom.is_finite() { zoom.clamp(1.0, 4.0) } else { 1.0 };
            let zw = (w as f64 * z).ceil() as u32;
            let zh = (h as f64 * z).ceil() as u32;
            let fx = (1.0 + pan_x.clamp(-1.0, 1.0)) / 2.0;
            let fy = (1.0 + pan_y.clamp(-1.0, 1.0)) / 2.0;
            let gb = if *blur > 0.0 { format!(",gblur=sigma={blur}") } else { String::new() };
            let dm = if *dim > 0.0 {
                format!(",lutyuv=y='val*{}'", 1.0 - dim.clamp(0.0, 0.95))
            } else {
                String::new()
            };
            format!(
                "[1:v]scale={zw}:{zh}:force_original_aspect_ratio=increase:flags=lanczos,\
                 crop={w}:{h}:'(iw-ow)*{fx:.4}':'(ih-oh)*{fy:.4}'{gb}{dm}[bg2];\
                 [0:v]{tf}{fg}[fg2];\
                 [bg2][fg2]overlay={dx}:{dy}:shortest=1"
            )
        }
    };
    if p.border >= 1.0 && !covers {
        let b = p.border.round() as i64;
        out.push_str(&format!(
            ",drawbox=x={}:y={}:w={}:h={}:color={}:t={b}",
            (p.x - p.border).round() as i64,
            (p.y - p.border).round() as i64,
            (p.w + 2.0 * p.border).round() as i64,
            (p.h + 2.0 * p.border).round() as i64,
            spec.border.1,
        ));
    }
    out
}

fn clamp01(v: f64) -> f64 {
    v.clamp(-1.0, 1.0)
}

fn fmt_fps(f: f64) -> String {
    if f.fract() == 0.0 {
        format!("{}", f as u32)
    } else {
        format!("{f:.3}")
    }
}

// ── Bitrate / quality mapping ───────────────────────────────────────────────

/// Target bitrate (kbps): explicit override wins, else bits-per-pixel
/// heuristic scaled by canvas/fps/codec.
pub fn bitrate_kbps(spec: &RenderSpec, fps: f64) -> u64 {
    if let Some(b) = spec.export.bitrate_kbps {
        return b.clamp(200, 200_000);
    }
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
    if let Background::Image { path, .. } = &spec.background {
        args.extend(["-loop".into(), "1".into(), "-i".into(), path.clone()]);
    }
    // Overlay video input (index 2 when an image bg exists, else 1).
    if let Some(ov) = &spec.overlay {
        args.extend(["-i".into(), ov.path.clone()]);
    }
    // Watermark image input (always the last input).
    if let Some(wm) = &spec.watermark {
        args.extend(["-loop".into(), "1".into(), "-i".into(), wm.path.clone()]);
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
    if let Background::Image { path, .. } = &spec.background {
        cmd.args(["-loop".into(), "1".into(), "-i".into(), path.clone()]);
    }
    if let Some(ov) = &spec.overlay {
        cmd.args(["-i".into(), ov.path.clone()]);
    }
    if let Some(wm) = &spec.watermark {
        cmd.args(["-loop".into(), "1".into(), "-i".into(), wm.path.clone()]);
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
            overlay: None,
            rotate: 0,
            flip: false,
            watermark: None,
            guides: cr_model::Guides {
                safe: false,
                thirds: false,
                center: false,
                export: false,
            },
            export: ExportSpec {
                codec: VideoCodec::H264,
                quality: QualityPreset::Balanced,
                bitrate_kbps: None,
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

    fn fill(zoom: f64, pan_x: f64, pan_y: f64) -> FitSpec {
        FitSpec::Fill { offset_x: 0.0, offset_y: 0.0, zoom, pan_x, pan_y }
    }

    fn fit(zoom: f64, pan_x: f64, pan_y: f64) -> FitSpec {
        FitSpec::Fit { zoom, offset_x: 0.0, offset_y: 0.0, pan_x, pan_y }
    }

    fn solid() -> Background {
        Background::Solid { color: "#101418".into() }
    }

    #[test]
    fn fill_covers_with_source_crop_and_no_background() {
        let g = filtergraph(&spec(fill(1.0, 0.0, 0.0), solid()), 1920, 1080);
        // 1920x1080 → cover 1080x1920 keeps a centred 608x1080 source strip.
        assert!(g.starts_with("crop=608:1080:656:0:exact=1,scale="), "{g}");
        assert!(g.contains(",crop=1080:1920:0:0:exact=1"), "{g}");
        assert!(!g.contains("pad="), "covering fg needs no background: {g}");
        assert!(g.ends_with("format=yuv420p"));
        assert!(!g.contains("fps=")); // source fps → no fps filter
    }

    #[test]
    fn fit_solid_letterboxes_with_pad() {
        let g = filtergraph(&spec(fit(1.0, 0.0, 0.0), solid()), 1920, 1080);
        assert!(g.starts_with("scale=1080:608:flags=lanczos,pad=1080:1920:0:656:#101418"), "{g}");
    }

    #[test]
    fn fit_blur_splits_and_overlays_at_exact_position() {
        let g = filtergraph(
            &spec(fit(1.0, 0.0, 0.0), Background::Blur { sigma: 20.0, dim: 0.4 }),
            1920,
            1080,
        );
        for part in ["split[fg][bg]", "gblur=sigma=20", "lutyuv=y='val*0.6'", "overlay=0:656"] {
            assert!(g.contains(part), "missing {part} in {g}");
        }
    }

    #[test]
    fn zoomed_out_fg_can_leave_the_canvas() {
        // fg 540x304 pushed half a canvas right: only its left part is visible.
        let s = spec(fit(0.5, 0.5, 0.0), solid());
        let p = placement(&s, 1920, 1080);
        assert!((p.x - 1080.0 + 270.0).abs() < 1e-6, "{p:?}");
        let g = filtergraph(&s, 1920, 1080);
        assert!(g.contains(",pad=1080:1920:810:"), "{g}");
        assert!(g.starts_with("crop=960:1080:0:0:exact=1,scale=270:304"), "{g}");
    }

    #[test]
    fn pan_is_zoom_independent() {
        // Same pan at different zooms keeps the fg centre at the same spot.
        for z in [0.3, 0.316, 0.5, 1.0, 2.0, 8.0] {
            let p = placement(&spec(fill(z, 0.2, -0.1), solid()), 1920, 1080);
            assert!((p.x + p.w / 2.0 - (540.0 + 216.0)).abs() < 1e-6, "zoom {z}: {p:?}");
            assert!((p.y + p.h / 2.0 - (960.0 - 192.0)).abs() < 1e-6, "zoom {z}: {p:?}");
        }
    }

    #[test]
    fn big_zoom_crops_source_before_scaling() {
        let g = filtergraph(&spec(fill(8.0, 0.0, 0.0), solid()), 1920, 1080);
        // Never scales the whole frame to 8x: source is cropped first.
        assert!(g.starts_with("crop=76:136:922:472:exact=1,scale="), "{g}");
    }

    #[test]
    fn legacy_offsets_still_render_like_before() {
        // Old Fill offset_x=1 pinned the source's right edge to the canvas edge.
        let s = spec(
            FitSpec::Fill { offset_x: 2.0, offset_y: -5.0, zoom: 1.5, pan_x: 0.0, pan_y: 0.0 },
            solid(),
        );
        let p = placement(&s, 1920, 1080);
        assert!((p.x + p.w - 1080.0).abs() < 1e-6, "{p:?}");
        assert!(p.y.abs() < 1e-6, "{p:?}");
    }

    #[test]
    fn border_is_drawn_around_the_placed_fg() {
        let mut s = spec(fit(1.0, 0.0, 0.0), solid());
        s.border = (6.0, "#ffffff".into());
        let g = filtergraph(&s, 1920, 1080);
        assert!(g.contains("drawbox=x=-6:y=650:w=1092:h=620:color=#ffffff:t=6"), "{g}");
    }

    #[test]
    fn image_background_zoom_pan_blur_and_dim() {
        let bg = Background::Image { path: "bg.png".into(), blur: 4.0, dim: 0.3, zoom: 2.0, pan_x: 1.0, pan_y: -1.0 };
        let g = filtergraph(&spec(fit(1.0, 0.0, 0.0), bg), 1920, 1080);
        assert!(g.contains("[1:v]scale=2160:3840:force_original_aspect_ratio=increase"), "{g}");
        assert!(g.contains("crop=1080:1920:'(iw-ow)*1.0000':'(ih-oh)*0.0000'"), "{g}");
        assert!(g.contains("gblur=sigma=4,lutyuv=y='val*0.7'[bg2]"), "{g}");
        // The looped still is the main overlay input: without shortest=1
        // the output never ends.
        assert!(g.contains("[bg2][fg2]overlay=") && g.contains(":shortest=1"), "{g}");
    }

    #[test]
    fn legacy_image_background_deserializes_with_defaults() {
        let bg: Background = serde_json::from_str(r#"{"kind":"image","path":"a.png","blur":2}"#).unwrap();
        assert_eq!(bg, Background::Image { path: "a.png".into(), blur: 2.0, dim: 0.0, zoom: 1.0, pan_x: 0.0, pan_y: 0.0 });
    }

    #[test]
    fn rotation_and_flip_stay_inside_the_main_input_chain() {
        let mut s = spec(fit(1.0, 0.0, 0.0), Background::Image { path: "bg.png".into(), blur: 0.0, dim: 0.0, zoom: 1.0, pan_x: 0.0, pan_y: 0.0 });
        s.rotate = 90;
        s.flip = true;
        let g = filtergraph(&s, 1920, 1080);
        assert!(g.contains("[0:v]hflip,transpose=1,"), "{g}");
        // Rotated 1080x1920 source exactly fills the 9:16 canvas.
        assert!(g.contains("overlay=0:0"), "{g}");
        let a = build_args(&s, &meta(), "h264_mf", Path::new("o.mp4")).join(" ");
        assert!(a.contains("-loop 1 -i bg.png"), "{a}");
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
        let mut s = spec(fit(1.0, 0.0, 0.0), Background::Solid { color: "#000".into() });
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
            &spec(fit(1.0, 0.0, 0.0), Background::Solid { color: "#000".into() }),
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
