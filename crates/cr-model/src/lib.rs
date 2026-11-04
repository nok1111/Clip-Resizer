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
