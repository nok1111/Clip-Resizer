use cr_model::AppInfo;
use tauri::AppHandle;

use crate::error::{CommandError, CommandResult};
use crate::state::AppState;

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    let pkg = app.package_info();
    AppInfo {
        name: pkg.name.clone(),
        version: pkg.version.to_string(),
        tauri_version: tauri::VERSION.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        logical_cpus: std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1),
        ffmpeg_available: cr_ffmpeg::bin_dir().is_some(),
        ffmpeg_version: cr_ffmpeg::version(),
    }
}

/// Opens the latest batch's output folder, else the configured default, in the
/// system file manager. The path never comes from the frontend, so the webview
/// cannot ask the OS to open arbitrary paths.
#[tauri::command]
pub fn open_output_dir(app: AppHandle, state: tauri::State<'_, AppState>) -> CommandResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let last = state
        .last_output_dir
        .lock()
        .ok()
        .and_then(|d| d.as_ref().map(|p| p.to_string_lossy().into_owned()));
    let dir = match last {
        Some(d) => d,
        None => state
            .store
            .settings()?
            .default_output_dir
            .ok_or_else(|| CommandError::new("no_output_dir", "no default output folder is configured"))?,
    };
    if !std::path::Path::new(&dir).is_dir() {
        return Err(CommandError::new(
            "output_dir_missing",
            format!("folder does not exist: {dir}"),
        ));
    }
    app.opener()
        .open_path(dir, None::<&str>)
        .map_err(|e| CommandError::new("open_failed", e.to_string()))
}
