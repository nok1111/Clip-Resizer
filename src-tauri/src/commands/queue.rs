use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use cr_ffmpeg::render;
use cr_model::{ConflictPolicy, QueueEvent, QueueItem, QueueStatus, RenderSpec};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use crate::error::{CommandError, CommandResult};
use crate::state::AppState;

/// Backend queue entry (spec kept for retry; item is the UI projection).
pub struct Entry {
    pub item: QueueItem,
    pub spec: RenderSpec,
    pub cancel: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct QueueState {
    pub entries: Mutex<VecDeque<Entry>>,
    pub next_id: Mutex<u32>,
    /// One forwarder channel per subscribed client (latest wins).
    pub channel: Mutex<Option<Channel<QueueEvent>>>,
    /// Worker wakeups: running flag + notified flag keep it single-threaded.
    pub running: AtomicBool,
    pub shutdown: AtomicBool,
}

fn snapshot(q: &QueueState) -> Vec<QueueItem> {
    q.entries
        .lock()
        .map(|e| e.iter().map(|x| x.item.clone()).collect())
        .unwrap_or_default()
}

fn emit(q: &QueueState, ev: QueueEvent) {
    if let Ok(ch) = q.channel.lock() {
        if let Some(ch) = ch.as_ref() {
            let _ = ch.send(ev);
        }
    }
}

fn set_item(q: &QueueState, id: u32, f: impl FnOnce(&mut QueueItem)) {
    let mut it = None;
    if let Ok(mut entries) = q.entries.lock() {
        if let Some(e) = entries.iter_mut().find(|e| e.item.id == id) {
            f(&mut e.item);
            it = Some(e.item.clone());
        }
    }
    if let Some(item) = it {
        emit(q, QueueEvent::Item { item });
    }
}

/// Adds specs to the queue; returns their ids.
#[tauri::command]
pub fn enqueue_render(
    app: AppHandle,
    state: State<'_, AppState>,
    specs: Vec<RenderSpec>,
    output_dir: String,
    conflict: ConflictPolicy,
    on_event: Channel<QueueEvent>,
) -> CommandResult<Vec<u32>> {
    {
        let viewable = state
            .viewable
            .lock()
            .map_err(|_| CommandError::new("internal", "state lock poisoned"))?;
        for s in &specs {
            if !viewable.contains(&PathBuf::from(&s.input)) {
                return Err(CommandError::new("invalid", format!("{} is not imported", s.input)));
            }
        }
        if let Ok(mut ch) = state.queue.channel.lock() {
            *ch = Some(on_event.clone());
        }
    }
    let dir = PathBuf::from(&output_dir);
    if !dir.is_dir() {
        return Err(CommandError::new("output_dir_missing", format!("{output_dir}")));
    }
    let encoders = render::encoders()?;
    let mut ids = Vec::new();
    {
        let mut entries = state
            .queue
            .entries
            .lock()
            .map_err(|_| CommandError::new("internal", "queue lock poisoned"))?;
        let mut next = state.queue.next_id.lock().unwrap();
        for spec in specs {
            let id = {
                *next += 1;
                *next
            };
            let name = PathBuf::from(&spec.input)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| spec.input.clone());
            let mut spec = spec;
            if render::pick_encoder(spec.export.codec, &encoders).is_none() {
                // Fallback to the other codec when the requested one is absent.
                spec.export.codec = match spec.export.codec {
                    cr_model::VideoCodec::H264 => cr_model::VideoCodec::H265,
                    cr_model::VideoCodec::H265 => cr_model::VideoCodec::H264,
                };
                if render::pick_encoder(spec.export.codec, &encoders).is_none() {
                    return Err(CommandError::new("no_encoder", "no video encoder available"));
                }
            }
            entries.push_back(Entry {
                item: QueueItem {
                    id,
                    name,
                    status: QueueStatus::Pending,
                    pct: 0.0,
                    out_path: None,
                    error: None,
                },
                spec,
                cancel: Arc::new(AtomicBool::new(false)),
            });
            ids.push(id);
        }
        drop(next);
        let out_dir = dir.clone();
        entries.iter_mut().for_each(|e| {
            if e.item.status == QueueStatus::Pending && e.spec.export.fps.is_none() {
                // keep as-is
            }
            let _ = &out_dir;
        });
    }
    emit(&state.queue, QueueEvent::Snapshot { items: snapshot(&state.queue) });
    spawn_worker(&app, dir, conflict);
    Ok(ids)
}

fn spawn_worker(app: &AppHandle, dir: PathBuf, conflict: ConflictPolicy) {
    {
        let state = app.state::<AppState>();
        let entries = match state.queue.entries.lock() {
            Ok(e) => e,
            Err(_) => return,
        };
        // Atomically take worker ownership only when not running.
        if state.queue.running.swap(true, Ordering::SeqCst) {
            return; // a worker is already draining the shared queue
        }
        if entries.is_empty() {
            state.queue.running.store(false, Ordering::SeqCst);
            return;
        }
    }
    let app = app.clone();
    std::thread::Builder::new()
        .name("cr-queue".into())
        .spawn(move || {
            let state = app.state::<AppState>().inner();
            let encoders = render::encoders().unwrap_or_default();
            loop {
                if state.queue.shutdown.load(Ordering::Relaxed) {
                    state.queue.running.store(false, Ordering::SeqCst);
                    return;
                }
                // Claim next pending; clearing `running` under the same lock
                // means a push that happens after sees running=false and
                // spawns a fresh worker — no lost wakeup.
                let claimed = {
                    let mut entries = match state.queue.entries.lock() {
                        Ok(e) => e,
                        Err(_) => {
                            state.queue.running.store(false, Ordering::SeqCst);
                            return;
                        }
                    };
                    let c = entries.iter_mut().find_map(|e| {
                        (e.item.status == QueueStatus::Pending).then(|| {
                            e.item.status = QueueStatus::Processing;
                            let encoder =
                                render::pick_encoder(e.spec.export.codec, &encoders).unwrap_or_default();
                            (e.item.id, e.spec.clone(), e.cancel.clone(), encoder)
                        })
                    });
                    if c.is_none() {
                        state.queue.running.store(false, Ordering::SeqCst);
                        return;
                    }
                    c
                };
                let Some((id, spec, cancel, encoder)) = claimed else {
                    return; // unreachable: c.is_none() exits under the lock
                };
                emit(&state.queue, QueueEvent::Item {
                    item: item_of(&state.queue, id),
                });

                let input = PathBuf::from(&spec.input);
                let meta = cr_ffmpeg::probe(&input).meta;
                let out = meta.as_ref().and_then(|_| {
                    render::resolve_output(&dir, &input, spec.canvas, conflict)
                });
                let (status, out_path, error) = match (meta, out) {
                    (None, _) => (
                        QueueStatus::Failed,
                        None,
                        Some("input probe failed".into()),
                    ),
                    (_, None) => (QueueStatus::Skipped, None, None),
                    (Some(meta), Some(final_path)) => {
                        let tmp = final_path.with_extension("clipresizer-tmp");
                        let (tx, rx) = mpsc::channel::<f64>();
                        let fwd = {
                            let q = state.queue.clone();
                            std::thread::spawn(move || {
                                let mut last = Instant::now();
                                let mut pct = None;
                                loop {
                                    match rx.recv_timeout(Duration::from_millis(100)) {
                                        Ok(p) => pct = Some(p),
                                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                                        Err(_) => break,
                                    }
                                    if pct.is_some() && last.elapsed() >= Duration::from_millis(100) {
                                        set_item(&q, id, |i| i.pct = pct.unwrap());
                                        pct = None;
                                        last = Instant::now();
                                    }
                                }
                            })
                        };
                        let mut _job = None;
                        let r = render::run_render(
                            &spec,
                            &meta,
                            &encoder,
                            &tmp,
                            &cancel,
                            |p| {
                                let _ = tx.send(p.frac * 100.0);
                            },
                            |child| {
                                _job = crate::job_object::JobObject::for_child(child).ok();
                            },
                        );
                        drop(tx);
                        let _ = fwd.join();
                        match (r, cancel.load(Ordering::Relaxed)) {
                            (Ok(()), false) => match render::verify_output(&tmp, spec.canvas, meta.duration_ms) {
                                Ok(()) => {
                                    let _ = std::fs::rename(&tmp, &final_path);
                                    let bytes = std::fs::metadata(&final_path).map(|m| m.len()).unwrap_or(0) as i64;
                                    let finished = std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .map(|d| d.as_millis() as i64)
                                        .unwrap_or(0);
                                    let _ = state.store.insert_render(
                                        &spec.input,
                                        &final_path.to_string_lossy(),
                                        "done",
                                        bytes,
                                        finished,
                                    );
                                    (
                                        QueueStatus::Done,
                                        Some(final_path.to_string_lossy().into_owned()),
                                        None,
                                    )
                                }
                                Err(e) => {
                                    let _ = std::fs::remove_file(&tmp);
                                    (QueueStatus::Failed, None, Some(e.to_string()))
                                }
                            },
                            (_, true) => {
                                let _ = std::fs::remove_file(&tmp);
                                (QueueStatus::Cancelled, None, None)
                            }
                            (Err(e), false) => {
                                let _ = std::fs::remove_file(&tmp);
                                (QueueStatus::Failed, None, Some(e.to_string()))
                            }
                        }
                    }
                };
                set_item(&state.queue, id, |i| {
                    i.status = status;
                    i.pct = if status == QueueStatus::Done { 100.0 } else { i.pct };
                    i.out_path = out_path.clone();
                    i.error = error.clone();
                });
            }
        })
        .expect("spawn queue worker");
}

fn item_of(q: &QueueState, id: u32) -> QueueItem {
    q.entries
        .lock()
        .ok()
        .and_then(|e| e.iter().find(|x| x.item.id == id).map(|x| x.item.clone()))
        .unwrap_or(QueueItem {
            id,
            name: String::new(),
            status: QueueStatus::Pending,
            pct: 0.0,
            out_path: None,
            error: None,
        })
}

#[tauri::command]
pub fn queue_items(state: State<'_, AppState>) -> CommandResult<Vec<QueueItem>> {
    Ok(snapshot(&state.queue))
}

#[tauri::command]
pub fn queue_cancel(state: State<'_, AppState>, id: u32) -> CommandResult<bool> {
    let found = {
        let mut entries = state
            .queue
            .entries
            .lock()
            .map_err(|_| CommandError::new("internal", "queue lock poisoned"))?;
        match entries.iter_mut().find(|e| e.item.id == id) {
            Some(e) if e.item.status == QueueStatus::Processing => {
                e.cancel.store(true, Ordering::Relaxed);
                true
            }
            Some(e) if e.item.status == QueueStatus::Pending => {
                e.item.status = QueueStatus::Cancelled;
                true
            }
            _ => false,
        }
    };
    if found {
        emit(&state.queue, QueueEvent::Item { item: item_of(&state.queue, id) });
    }
    Ok(found)
}

#[tauri::command]
pub fn queue_retry(app: AppHandle, state: State<'_, AppState>, id: u32) -> CommandResult<bool> {
    let found = {
        let mut entries = state
            .queue
            .entries
            .lock()
            .map_err(|_| CommandError::new("internal", "queue lock poisoned"))?;
        match entries.iter_mut().find(|e| e.item.id == id) {
            Some(e)
                if matches!(
                    e.item.status,
                    QueueStatus::Failed | QueueStatus::Cancelled | QueueStatus::Skipped
                ) =>
            {
                e.item.status = QueueStatus::Pending;
                e.item.pct = 0.0;
                e.item.error = None;
                e.cancel = Arc::new(AtomicBool::new(false));
                true
            }
            _ => false,
        }
    };
    if found {
        emit(&state.queue, QueueEvent::Item { item: item_of(&state.queue, id) });
        let dir = state
            .last_output_dir
            .lock()
            .ok()
            .and_then(|d| d.clone())
            .or_else(|| {
                state
                    .store
                    .settings()
                    .ok()
                    .and_then(|s| s.default_output_dir)
                    .map(PathBuf::from)
            });
        if let Some(dir) = dir {
            spawn_worker(&app, dir, ConflictPolicy::Rename);
        }
    }
    Ok(found)
}

#[tauri::command]
pub fn queue_remove(state: State<'_, AppState>, id: u32) -> CommandResult<bool> {
    let found = {
        let mut entries = state
            .queue
            .entries
            .lock()
            .map_err(|_| CommandError::new("internal", "queue lock poisoned"))?;
        match entries.iter().position(|e| e.item.id == id) {
            Some(i) if entries[i].item.status != QueueStatus::Processing => {
                entries.remove(i);
                true
            }
            _ => false,
        }
    };
    if found {
        emit(&state.queue, QueueEvent::Snapshot { items: snapshot(&state.queue) });
    }
    Ok(found)
}

#[tauri::command]
pub fn render_history(state: State<'_, AppState>) -> CommandResult<Vec<cr_model::HistoryRow>> {
    Ok(state.store.recent_renders(100)?)
}
