mod commands;
mod error;
mod job_object;
// clipvid/clipthumb removed: media is served via Tauri's asset protocol
// (convertFileSrc), which WebView2's media pipeline accepts.
mod policy;
mod state;
mod thumbnails;

use state::AppState;
use tauri::Manager;

const DB_FILE: &str = "clipresizer.sqlite3";
const THUMB_DIR: &str = "thumbs";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let store = cr_store::Store::open(&data_dir.join(DB_FILE))?;
            let thumbs_dir = app.path().app_cache_dir()?.join(THUMB_DIR);
            std::fs::create_dir_all(&thumbs_dir)?;
            app.manage(AppState {
                store,
                thumbs_dir,
                viewable: Default::default(),
                last_output_dir: Default::default(),
                running_render: Default::default(),
                queue: Default::default(),
            });
            Ok(())
        })
        .register_uri_scheme_protocol("clipthumb", |ctx, req| {
            let state = ctx.app_handle().state::<AppState>();
            let name = req.uri().path();
            match thumbnails::read(&state.thumbs_dir, name) {
                Ok((data, mime)) => tauri::http::Response::builder()
                    .header("Content-Type", mime)
                    .header("Cache-Control", "max-age=3600")
                    .body(data)
                    .unwrap(),
                Err(_) => tauri::http::Response::builder()
                    .status(404)
                    .body(Vec::new())
                    .unwrap(),
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_info,
            commands::app::open_output_dir,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::license::license_status,
            commands::license::license_activate,
            commands::license::license_deactivate,
            commands::settings::reset_settings,
            commands::media::scan_inputs,
            commands::media::probe_videos,
            commands::media::video_thumbnail,
            commands::media::reveal_path,
            commands::media::pick_output_dir,
            commands::jobs::list_encoders,
            commands::jobs::resolve_encoder,
            commands::jobs::preview_frame,
            commands::jobs::start_render,
            commands::jobs::cancel_render,
            commands::queue::enqueue_render,
            commands::queue::queue_items,
            commands::queue::queue_cancel,
            commands::queue::queue_retry,
            commands::queue::queue_remove,
            commands::queue::render_history,
            commands::queue::edition,
            commands::queue::save_preset,
            commands::queue::list_presets,
            commands::queue::delete_preset,
            commands::jobs::preview_proxy,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Clip Resizer");
}
