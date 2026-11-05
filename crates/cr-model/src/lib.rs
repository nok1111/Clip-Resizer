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
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "kind")]
#[ts(export)]
pub enum FitSpec {
    /// Cover the canvas; offset/zoom position the visible window.
    /// offsets are -1..1 of the crop slack; zoom >= 1 multiplies the cover scale.
    Fill {
        offset_x: f64,
        offset_y: f64,
        zoom: f64,
    },
    /// Fit whole frame inside the canvas (letterbox via `background`).
    Fit,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "kind")]
#[ts(export)]
pub enum Background {
    /// Letterbox bars in a solid "#rrggbb" color.
    Solid { color: String },
    /// Enlarged blurred copy of the video behind the fitted frame.
    Blur { sigma: f64, dim: f64 },
    /// Imported still image; `blur` optionally softens it (0 = off).
    Image { path: String, blur: f64 },
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
    pub export: ExportSpec,
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
