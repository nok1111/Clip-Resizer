//! Disk thumbnail cache: PNG frames keyed by
//! sha256(path|size|mtime|seek|target), served via `clipthumb://`.
//! Rendering uses the vendored ffmpeg (one frame, scaled).

use std::path::Path;

use cr_model::ThumbInfo;
use sha2::{Digest, Sha256};

use crate::error::{CommandError, CommandResult};

/// Cache key from an arbitrary seed (frame previews carry spec params).
pub fn named_key(path: &Path, seed: &str) -> CommandResult<String> {
    let meta = path
        .metadata()
        .map_err(|e| CommandError::new("io", format!("stat {}: {e}", path.display())))?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let hex = format!(
        "{:x}",
        Sha256::digest(format!("{}|{}|{mtime}|{seed}", path.display(), meta.len()).as_bytes())
    );
    Ok(format!("{}.png", &hex[..24]))
}

fn key(path: &Path, seek_s: f64, target: u32) -> CommandResult<String> {
    let meta = path
        .metadata()
        .map_err(|e| CommandError::new("io", format!("stat {}: {e}", path.display())))?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let seed = format!(
        "{}|{}|{mtime}|{seek_s:.2}|{target}",
        path.display(),
        meta.len()
    );
    let hex = format!("{:x}", Sha256::digest(seed.as_bytes()));
    Ok(format!("{}.png", &hex[..24]))
}

/// Reads a cached thumbnail by file name (clipthumb:// handler).
/// Only `*.png` names inside the cache dir are ever served.
pub fn read(cache_dir: &Path, name: &str) -> CommandResult<(Vec<u8>, &'static str)> {
    let name = name.rsplit('/').next().unwrap_or(name);
    if !name.ends_with(".png") || name.contains("..") {
        return Err(CommandError::new("invalid", "bad thumbnail name"));
    }
    let data =
        std::fs::read(cache_dir.join(name)).map_err(|e| CommandError::new("io", e.to_string()))?;
    Ok((data, "image/png"))
}

/// Returns (or produces) the thumbnail for one video.
pub fn get(cache_dir: &Path, path: &Path, seek_s: f64, target: u32) -> CommandResult<ThumbInfo> {
    std::fs::create_dir_all(cache_dir).map_err(|e| CommandError::new("io", e.to_string()))?;
    let name = key(path, seek_s, target)?;
    let file = cache_dir.join(&name);

    if file.exists() {
        return Ok(ThumbInfo {
            url: file.to_string_lossy().into_owned(),
            width: 0,
            height: 0,
            cached: true,
        });
    }

    cr_ffmpeg::thumbnail(path, &file, seek_s, target)?;

    Ok(ThumbInfo {
        url: file.to_string_lossy().into_owned(),
        width: 0,
        height: 0,
        cached: false,
    })
}
