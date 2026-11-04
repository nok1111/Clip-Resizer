use serde::Serialize;

/// Error returned to the frontend: a stable machine-readable `code` plus a
/// human-readable `message` (English; the UI localizes by `code`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: &'static str,
    pub message: String,
}

impl CommandError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

pub type CommandResult<T> = Result<T, CommandError>;

impl From<cr_store::StoreError> for CommandError {
    fn from(e: cr_store::StoreError) -> Self {
        let code = match e {
            cr_store::StoreError::Invalid { .. } => "invalid_setting",
            _ => "storage",
        };
        Self {
            code,
            message: e.to_string(),
        }
    }
}

impl From<cr_ffmpeg::FfmpegError> for CommandError {
    fn from(e: cr_ffmpeg::FfmpegError) -> Self {
        let code = match e {
            cr_ffmpeg::FfmpegError::Missing => "missing_ffmpeg",
            cr_ffmpeg::FfmpegError::Spawn { .. } => "spawn_failed",
            cr_ffmpeg::FfmpegError::Process { .. } => "ffmpeg_failed",
            cr_ffmpeg::FfmpegError::Parse(_) => "parse_failed",
            cr_ffmpeg::FfmpegError::Io(_) => "io",
        };
        Self {
            code,
            message: e.to_string(),
        }
    }
}
