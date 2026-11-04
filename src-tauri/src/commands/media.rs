use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

use cr_model::{ProbeResult, ScanResult, ThumbInfo};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::error::{CommandError, CommandResult};
use crate::state::AppState;
use crate::thumbnails;

/// Expands dropped/selected files and folders off the main thread and
/// whitelists accepted videos for clipvid://.
#[tauri::command]
pub async fn scan_inputs(app: AppHandle, paths: Vec<String>) -> CommandResult<ScanResult> {
    let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    let scanned = tauri::async_runtime::spawn_blocking(move || {
        cr_files::scan(&paths, &AtomicBool::new(false))
    })
    .await
    .map_err(|e| CommandError::new("internal", e.to_string()))?;
    if let Ok(mut viewable) = app.state::<AppState>().viewable.lock() {
        viewable.extend(scanned.files.iter().map(|f| PathBuf::from(&f.path)));
    }
    Ok(scanned)
}

/// ffprobe metadata for whitelisted inputs, off the main thread. One call
/// per batch of paths so the UI does not pay an IPC round-trip per file.
#[tauri::command]
pub async fn probe_videos(app: AppHandle, paths: Vec<String>) -> CommandResult<Vec<ProbeResult>> {
    let allowed: Vec<PathBuf> = {
        let state = app.state::<AppState>();
        let viewable = state
            .viewable
            .lock()
            .map_err(|e| CommandError::new("internal", format!("state lock poisoned: {e}")))?;
        paths
            .into_iter()
            .map(PathBuf::from)
            .filter(|p| viewable.contains(p))
            .collect()
    };
    tauri::async_runtime::spawn_blocking(move || cr_ffmpeg::probe_many(&allowed))
    .await
    .map_err(|e| CommandError::new("internal", e.to_string()))
}

/// Thumbnail for one whitelisted input (clipthumb:// URL).
#[tauri::command]
pub async fn video_thumbnail(
    state: State<'_, AppState>,
    path: String,
    seek_s: Option<f64>,
    target: Option<u32>,
) -> CommandResult<ThumbInfo> {
    let p = PathBuf::from(&path);
    let allowed = state
        .viewable
        .lock()
        .map(|v| v.contains(&p))
        .unwrap_or(false);
    if !allowed {
        return Err(CommandError::new(
            "invalid",
            "thumbnail requested for a file that was never imported",
        ));
    }
    let seek = seek_s.unwrap_or(1.0).max(0.0);
    let target = target.unwrap_or(320).clamp(64, 1280);
    let thumbs = state.thumbs_dir.clone();
    tauri::async_runtime::spawn_blocking(move || thumbnails::get(&thumbs, &p, seek, target))
        .await
        .map_err(|e| CommandError::new("internal", e.to_string()))?
}

/// Shows an imported file in the system file manager — by whitelist, so the
/// webview cannot reveal arbitrary paths.
#[tauri::command]
pub fn reveal_path(app: AppHandle, state: State<'_, AppState>, path: String) -> CommandResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let p = PathBuf::from(&path);
    let allowed = state
        .viewable
        .lock()
        .map(|v| v.contains(&p))
        .unwrap_or(false);
    if !allowed || !p.is_file() {
        return Err(CommandError::new(
            "not_found",
            "file is not in the imported set",
        ));
    }
    app.opener()
        .reveal_item_in_dir(&p)
        .map_err(|e| CommandError::new("open_failed", e.to_string()))
}

/// Opens the OS folder picker and returns the chosen directory (the webview
/// never fabricates paths).
#[tauri::command]
pub fn pick_output_dir(app: AppHandle) -> CommandResult<Option<String>> {
    let picked = app.dialog().file().blocking_pick_folder();
    Ok(picked.map(|p| p.to_string()))
}
