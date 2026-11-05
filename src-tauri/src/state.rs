use cr_store::Store;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;



pub struct AppState {
    pub store: Store,
    /// Thumbnail cache dir (clipthumb:// serves only files inside it).
    pub thumbs_dir: PathBuf,
    /// Files the webview may read through clipvid:// — the scanned inputs
    /// plus written outputs. Protocol handlers refuse anything else.
    pub viewable: Mutex<HashSet<PathBuf>>,
    /// Output folder of the latest batch (for the status bar button).
    pub last_output_dir: Mutex<Option<PathBuf>>,
    /// Cancel token of the running render; one render at a time for now.
    pub running_render: Mutex<Option<std::sync::Arc<std::sync::atomic::AtomicBool>>>,
    /// Render queue (Phase 4): shared entries + worker guard.
    pub queue: std::sync::Arc<crate::commands::queue::QueueState>,
}
