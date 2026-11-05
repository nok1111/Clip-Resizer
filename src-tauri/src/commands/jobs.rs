use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use cr_ffmpeg::render;
use cr_model::{ConflictPolicy, RenderEvent, RenderSpec, ThumbInfo, VideoMeta};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use crate::error::{CommandError, CommandResult};
use crate::state::AppState;
use crate::thumbnails;

const FLUSH: Duration = Duration::from_millis(100);

/// Available encoder names (debug/About + Phase 5 advanced UI).
#[tauri::command]
pub fn list_encoders() -> CommandResult<Vec<String>> {
    Ok(render::encoders()?)
}

/// The encoder that will actually be used for a spec (honest UI).
#[tauri::command]
pub fn resolve_encoder(codec: cr_model::VideoCodec) -> CommandResult<Option<String>> {
    Ok(render::pick_encoder(codec, &render::encoders()?))
}

/// Renders one frame through the real filtergraph → clipthumb:// URL.
#[tauri::command]
pub async fn preview_frame(
    state: State<'_, AppState>,
    spec: RenderSpec,
    t_s: f64,
) -> CommandResult<ThumbInfo> {
    let p = PathBuf::from(&spec.input);
    let allowed = state
        .viewable
        .lock()
        .map(|v| v.contains(&p))
        .unwrap_or(false);
    if !allowed {
        return Err(CommandError::new("invalid", "input is not in the imported set"));
    }
    let meta = probe_meta(&p)?;
    let thumbs = state.thumbs_dir.clone();
    // Frame previews reuse the thumbnail cache: seek + canvas in the key.
    let seek = t_s.max(0.0);
    let key_seed = format!(
        "frame|{}x{}|{:?}|{:?}|{seek:.2}",
        spec.canvas.width, spec.canvas.height, spec.fit, spec.background
    );
    tauri::async_runtime::spawn_blocking(move || {
        let name = thumbnails::named_key(&p, &key_seed)?;
        let file = thumbs.join(&name);
        if !file.exists() {
            render::preview_frame(&spec, &meta, seek, &file)?;
        }
        Ok(ThumbInfo {
            url: format!("clipthumb://localhost/{name}"),
            width: 0,
            height: 0,
            cached: file.exists(),
        })
    })
    .await
    .map_err(|e| CommandError::new("internal", e.to_string()))?
}

fn probe_meta(p: &Path) -> CommandResult<VideoMeta> {
    let r = cr_ffmpeg::probe(p);
    r.meta.ok_or_else(|| {
        CommandError::new(
            "ffprobe_failed",
            r.error.map(|e| e.message).unwrap_or_else(|| "probe failed".into()),
        )
    })
}

/// Starts the single render slot. Events stream over `on_event` at ~10 Hz.
#[tauri::command]
pub fn start_render(
    app: AppHandle,
    state: State<'_, AppState>,
    spec: RenderSpec,
    output_dir: String,
    conflict: ConflictPolicy,
    on_event: Channel<RenderEvent>,
) -> CommandResult<()> {
    let input = PathBuf::from(&spec.input);
    {
        let viewable = state
            .viewable
            .lock()
            .map_err(|_| CommandError::new("internal", "state lock poisoned"))?;
        if !viewable.contains(&input) {
            return Err(CommandError::new("invalid", "input is not in the imported set"));
        }
    }
    let dir = PathBuf::from(&output_dir);
    if !dir.is_dir() {
        return Err(CommandError::new(
            "output_dir_missing",
            format!("folder does not exist: {output_dir}"),
        ));
    }
    let meta = probe_meta(&input)?;
    let Some(final_path) = render::resolve_output(&dir, &input, spec.canvas, conflict) else {
        let _ = on_event.send(RenderEvent::Skipped);
        return Ok(());
    };
    // Safety: output must never equal an input.
    if final_path.canonicalize().ok() == input.canonicalize().ok() {
        return Err(CommandError::new("invalid_job", "output path equals the input"));
    }
    let encoders = render::encoders()?;
    let encoder = render::pick_encoder(spec.export.codec, &encoders).ok_or_else(|| {
        CommandError::new(
            "no_encoder",
            format!("no {:?} encoder available in this FFmpeg build", spec.export.codec),
        )
    })?;

    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut slot = state
            .running_render
            .lock()
            .map_err(|_| CommandError::new("internal", "state lock poisoned"))?;
        if slot.is_some() {
            return Err(CommandError::new("busy", "a render is already running"));
        }
        *slot = Some(cancel.clone());
    }

    // Render next to the destination (same volume → atomic rename).
    let tmp = final_path.with_extension("clipresizer-tmp");
    let out_path = final_path.clone();
    std::thread::Builder::new()
        .name("cr-render".into())
        .spawn(move || {
            let (tx, rx) = mpsc::channel::<RenderEvent>();
            let forwarder = {
                let ch = on_event.clone();
                std::thread::spawn(move || forward_batched(rx, &ch))
            };
            let meta2 = meta.clone();
            let spec2 = spec.clone();
            let cancel2 = cancel.clone();
            let tmp2 = tmp.clone();
            let tx2 = tx.clone();
            let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
                let mut _job = None;
                render::run_render(&spec2, &meta2, &encoder, &tmp2, &cancel2, |p| {
                    let _ = tx2.send(RenderEvent::Progress {
                        pct: p.frac * 100.0,
                        out_s: p.out_s,
                        speed: p.speed,
                        size: p.size,
                    });
                }, |child| {
                    _job = crate::job_object::JobObject::for_child(child).ok();
                })
            }));
            drop(tx);
            let _ = forwarder.join();

            let event = match outcome {
                Err(_) => RenderEvent::Failed {
                    code: "panic".into(),
                    message: "render thread panicked".into(),
                },
                Ok(Err(e)) if cancel.load(Ordering::Relaxed) => {
                    let _ = std::fs::remove_file(&tmp);
                    RenderEvent::Cancelled
                }
                Ok(Err(e)) => {
                    let _ = std::fs::remove_file(&tmp);
                    RenderEvent::Failed {
                        code: "ffmpeg_failed".into(),
                        message: e.to_string(),
                    }
                }
                Ok(Ok(())) => match render::verify_output(&tmp, spec.canvas, meta.duration_ms) {
                    Ok(()) => {
                        if let Err(e) = std::fs::rename(&tmp, &out_path) {
                            let _ = std::fs::remove_file(&tmp);
                            RenderEvent::Failed {
                                code: "io".into(),
                                message: format!("publish failed: {e}"),
                            }
                        } else {
                            let bytes = std::fs::metadata(&out_path).map(|m| m.len()).unwrap_or(0);
                            if let Ok(mut v) = app.state::<AppState>().viewable.lock() {
                                v.insert(out_path.clone());
                            }
                            if let Ok(mut d) = app.state::<AppState>().last_output_dir.lock() {
                                *d = Some(dir.clone());
                            }
                            RenderEvent::Done {
                                path: out_path.to_string_lossy().into_owned(),
                                bytes,
                            }
                        }
                    }
                    Err(e) => {
                        let _ = std::fs::remove_file(&tmp);
                        RenderEvent::Failed {
                            code: "verify_failed".into(),
                            message: e.to_string(),
                        }
                    }
                },
            };
            let _ = on_event.send(event);
            if let Ok(mut slot) = app.state::<AppState>().running_render.lock() {
                *slot = None;
            }
        })
        .map_err(|e| CommandError::new("internal", e.to_string()))?;
    Ok(())
}

/// Requests cancellation of the running render. False if none is running.
#[tauri::command]
pub fn cancel_render(state: State<'_, AppState>) -> CommandResult<bool> {
    let slot = state
        .running_render
        .lock()
        .map_err(|_| CommandError::new("internal", "state lock poisoned"))?;
    Ok(slot.as_ref().is_some_and(|c| {
        c.store(true, Ordering::Relaxed);
        true
    }))
}

/// Batches events to ~10 Hz so the webview is never flooded.
fn forward_batched(rx: mpsc::Receiver<RenderEvent>, ch: &Channel<RenderEvent>) {
    let mut last: Option<RenderEvent> = None;
    let mut last_sent = Instant::now();
    loop {
        match rx.recv_timeout(FLUSH) {
            Ok(e) => last = Some(e),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
        if last.is_some() && last_sent.elapsed() >= FLUSH {
            let _ = ch.send(last.take().unwrap());
            last_sent = Instant::now();
        }
    }
    if let Some(e) = last {
        let _ = ch.send(e);
    }
}
