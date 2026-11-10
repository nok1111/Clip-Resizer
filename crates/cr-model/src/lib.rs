//! Shared IPC model types (ts-rs exports to src/lib/ipc/bindings).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum Theme {
    #[default]
    Dark,
    Light,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[ts(export)]
pub enum Language {
    /// Follow the operating system language, falling back to English.
    #[default]
    #[serde(rename = "system")]
    System,
    #[serde(rename = "en")]
    En,
    #[serde(rename = "es")]
    Es,
    #[serde(rename = "pt-BR")]
    PtBr,
}

/// Video containers accepted on import (checked by extension at scan time;
/// ffprobe validates the actual streams lazily).
pub const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mov", "mkv", "avi", "webm", "m4v"];

/// One accepted input file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LocalVideo {
    pub path: String,
    pub name: String,
    #[ts(type = "number")]
    pub size: u64,
}

/// Why a path was rejected at scan time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum RejectReason {
    /// Extension not in VIDEO_EXTENSIONS.
    UnsupportedType,
    /// Not a regular readable file.
    NotAFile,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RejectedFile {
    pub path: String,
    pub reason: RejectReason,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ScanResult {
    pub files: Vec<LocalVideo>,
    pub rejected: Vec<RejectedFile>,
    /// True when MAX_INPUTS was reached or the scan was cancelled.
    pub truncated: bool,
}

/// Stream/format facts produced by ffprobe.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct VideoMeta {
    /// Container duration in milliseconds (0 when unparseable).
    #[ts(type = "number")]
    pub duration_ms: i64,
    /// Display width/height after rotation metadata is applied.
    pub width: u32,
    pub height: u32,
    /// Frames per second (avg), 0 when unparseable.
    pub fps: f64,
    /// Video codec name ("h264", "hevc", "vp9", ...).
    pub codec: String,
    /// Container format ("mov,mp4,m4a,3gp,3g2,mj2" etc. as ffprobe reports).
    pub container: String,
    /// Overall bitrate in kbps when ffprobe reports one.
    pub bitrate_kbps: Option<u32>,
    /// Rotation from display metadata (0/90/180/270), applied to preview.
    pub rotation_deg: i32,
    pub has_audio: bool,
    /// Pixel format, e.g. "yuv420p" (used for compatibility checks later).
    pub pix_fmt: Option<String>,
}

/// Per-file probe outcome: metadata or a readable error.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProbeResult {
    pub path: String,
    pub meta: Option<VideoMeta>,
    /// Error code when ffprobe could not read the file.
    pub error: Option<ProbeError>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProbeError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub tauri_version: String,
    pub os: String,
    pub arch: String,
    pub logical_cpus: usize,
    /// ffmpeg/ffprobe availability + reported version string.
    pub ffmpeg_available: bool,
    pub ffmpeg_version: Option<String>,
}

/// Thumbnail reference returned to the webview.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ThumbInfo {
    /// `clipthumb://localhost/<file>` URL for the webview.
    pub url: String,
    pub width: u32,
    pub height: u32,
    pub cached: bool,
}

// ── Render model (one RenderSpec → one deterministic FFmpeg command) ────────

/// Output canvas in pixels (even numbers; encoders require it).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Canvas {
    pub width: u32,
    pub height: u32,
}

/// Named canvas presets shown in the UI; `custom` uses user dimensions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum AspectPreset {
    #[serde(rename = "9:16")]
    A9x16,
    #[serde(rename = "1:1")]
    A1x1,
    #[serde(rename = "4:5")]
    A4x5,
    #[serde(rename = "16:9")]
    A16x9,
    #[serde(rename = "4:3")]
    A4x3,
    #[serde(rename = "3:4")]
    A3x4,
    Custom,
}

/// How the source maps onto the canvas.
///
/// Position model: `pan_x`/`pan_y` move the foreground centre by a fraction
/// of the canvas (0 = centred, 0.5 = centre on the right/bottom edge). It is
/// independent of zoom, so zooming never makes the framing jump.
/// `offset_x`/`offset_y` are the legacy slack-relative offsets (-1..1),
/// kept only so presets saved before pan existed still render the same;
/// the UI folds them into pan and writes 0.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "kind")]
#[ts(export)]
pub enum FitSpec {
    /// Cover the canvas; zoom multiplies the cover scale (< 1 letterboxes).
    Fill {
        #[serde(default)]
        offset_x: f64,
        #[serde(default)]
        offset_y: f64,
        zoom: f64,
        #[serde(default)]
        pan_x: f64,
        #[serde(default)]
        pan_y: f64,
    },
    /// Fit whole frame inside the canvas (letterbox via `background`);
    /// zoom > 1 enlarges the fg past the canvas (it gets cropped).
    Fit {
        #[serde(default = "fit_zoom_default")]
        zoom: f64,
        #[serde(default)]
        offset_x: f64,
        #[serde(default)]
        offset_y: f64,
        #[serde(default)]
        pan_x: f64,
        #[serde(default)]
        pan_y: f64,
    },
}

fn fit_zoom_default() -> f64 {
    1.0
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "kind")]
#[ts(export)]
pub enum Background {
    /// Letterbox bars in a solid "#rrggbb" color.
    Solid { color: String },
    /// Enlarged blurred copy of the video behind the fitted frame.
    Blur { sigma: f64, dim: f64 },
    /// Imported still image, scaled to cover the canvas. `blur` softens it
    /// (0 = off), `dim` darkens 0..0.95, `zoom` ≥ 1 enlarges it and
    /// `pan_x`/`pan_y` (-1..1) pick which part of the enlarged image shows.
    Image {
        path: String,
        blur: f64,
        #[serde(default)]
        dim: f64,
        #[serde(default = "fit_zoom_default")]
        zoom: f64,
        #[serde(default)]
        pan_x: f64,
        #[serde(default)]
        pan_y: f64,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum VideoCodec {
    H264,
    H265,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum QualityPreset {
    Fast,
    Balanced,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum AudioMode {
    /// Copy the source audio stream when the MP4 accepts it.
    Copy,
    /// Re-encode to AAC 192k.
    Aac,
    /// Strip audio.
    Remove,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExportSpec {
    pub codec: VideoCodec,
    pub quality: QualityPreset,
    /// Explicit bitrate kbps; None = computed from canvas/fps/quality.
    #[ts(type = "number | null")]
    pub bitrate_kbps: Option<u64>,
    /// Target fps; None = keep source.
    pub fps: Option<f64>,
    pub audio: AudioMode,
}

/// Everything needed to render one video → one FFmpeg command.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RenderSpec {
    pub input: String,
    pub canvas: Canvas,
    pub fit: FitSpec,
    pub background: Background,
    /// Foreground inset 0..0.4 of the canvas short side (visual separation).
    pub margin: f64,
    /// Foreground border in px; 0 = none. With `#rrggbb` color.
    pub border: (f64, String),
    pub guides: Guides,
    /// Optional picture-in-picture overlay video (reaction-video style).
    #[serde(default)]
    pub overlay: Option<OverlaySpec>,
    /// Source rotation 0/90/180/270 degrees clockwise.
    #[serde(default)]
    pub rotate: u32,
    /// Mirror the source horizontally.
    #[serde(default)]
    pub flip: bool,
    /// Optional watermark image stamped on the whole video.
    #[serde(default)]
    pub watermark: Option<WatermarkSpec>,
    pub export: ExportSpec,
}

/// A still image overlaid at a position with opacity — watermark.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WatermarkSpec {
    /// Image file used as the watermark (png/jpg/webp…).
    pub path: String,
    /// Width as a fraction of the canvas width (0.02..1.0).
    pub scale: f64,
    /// Horizontal position -1..1: -1 left edge, 0 center, +1 right edge.
    pub offset_x: f64,
    /// Vertical position -1..1: -1 top, 0 center, +1 bottom.
    pub offset_y: f64,
    /// Opacity 0..1.
    pub opacity: f64,
}

/// A second video composited on top of the main composition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct OverlaySpec {
    /// Video file used as the overlay.
    pub path: String,
    /// Width as a fraction of the canvas width (0.05..1.0).
    pub scale: f64,
    /// Horizontal position -1..1: -1 left edge, 0 center, +1 right edge.
    pub offset_x: f64,
    /// Vertical position -1..1: -1 top, 0 center, +1 bottom.
    pub offset_y: f64,
}

/// Overlay guides; only burned into the output when `export` is true.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Guides {
    /// Safe margin box at ~5% inset.
    pub safe: bool,
    /// Rule-of-thirds grid.
    pub thirds: bool,
    /// Center cross.
    pub center: bool,
    /// Burn guides into the output (default: preview only).
    pub export: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ConflictPolicy {
    /// Write `name (2).mp4` when the target exists.
    #[default]
    Rename,
    /// Skip the render when the target exists.
    Skip,
    /// Overwrite an existing output (never an input).
    Overwrite,
}

/// Progress/events streamed to the UI during a render.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "kind")]
#[ts(export)]
pub enum RenderEvent {
    Progress {
        pct: f64,
        /// Processed output timestamp, seconds.
        out_s: f64,
        /// ffmpeg `speed=` factor (e.g. 2.5 = 2.5× realtime).
        speed: f64,
        /// Bytes written so far.
        size: u64,
    },
    Done {
        path: String,
        #[ts(type = "number")]
        bytes: u64,
    },
    Failed {
        code: String,
        message: String,
    },
    Cancelled,
    /// Target name existed and conflict policy was Skip.
    Skipped,
}

// ── Render queue (Phase 4) ──────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum QueueStatus {
    Pending,
    Processing,
    Done,
    Failed,
    Cancelled,
    Skipped,
}

/// One queued render as shown in the Queue UI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct QueueItem {
    pub id: u32,
    pub name: String,
    pub status: QueueStatus,
    /// 0-100 when Processing.
    pub pct: f64,
    pub out_path: Option<String>,
    pub error: Option<String>,
}

/// Queue snapshot + updates streamed to the UI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "kind")]
#[ts(export)]
pub enum QueueEvent {
    /// Full snapshot (sent on subscribe and after structural changes).
    Snapshot { items: Vec<QueueItem> },
    /// One item changed (progress or status).
    Item { item: QueueItem },
}

/// A finished render record (render_history).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct HistoryRow {
    pub id: i64,
    pub input: String,
    pub output: String,
    pub status: String,
    #[ts(type = "number")]
    pub bytes: i64,
    #[ts(type = "number")]
    pub finished_at: i64,
}
