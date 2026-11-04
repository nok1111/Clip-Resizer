//! Input intake: expands files/folders into a deduplicated video list.
//! Validation at scan time is by extension + readability only; ffprobe
//! validates streams lazily per item (a folder of hundreds of files must
//! import fast).

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use cr_model::{LocalVideo, RejectReason, RejectedFile, ScanResult, VIDEO_EXTENSIONS};
use walkdir::WalkDir;

/// Hard cap on accepted inputs per scan (protects the UI and the queue).
pub const MAX_INPUTS: usize = 2000;
/// Max folder recursion depth.
const MAX_DEPTH: usize = 8;

pub fn scan(paths: &[PathBuf], cancel: &AtomicBool) -> ScanResult {
    let mut seen = HashSet::<String>::new();
    let mut files = Vec::new();
    let mut rejected = Vec::new();
    let mut truncated = false;

    'outer: for root in paths {
        if cancel.load(Ordering::Relaxed) || files.len() >= MAX_INPUTS {
            truncated = true;
            break;
        }
        if root.is_dir() {
            for entry in WalkDir::new(root)
                .max_depth(MAX_DEPTH)
                .follow_links(false)
                .into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().is_file())
            {
                if cancel.load(Ordering::Relaxed) || files.len() >= MAX_INPUTS {
                    truncated = true;
                    break 'outer;
                }
                consider(entry.path(), &mut seen, &mut files, &mut rejected);
            }
        } else {
            consider(root, &mut seen, &mut files, &mut rejected);
        }
    }

    files.sort_by_key(|f| f.path.to_lowercase());
    ScanResult {
        files,
        rejected,
        truncated,
    }
}

fn consider(
    path: &Path,
    seen: &mut HashSet<String>,
    files: &mut Vec<LocalVideo>,
    rejected: &mut Vec<RejectedFile>,
) {
    let key = path.to_string_lossy().into_owned();
    if !seen.insert(key.clone()) {
        return;
    }
    let Ok(meta) = std::fs::metadata(path) else {
        rejected.push(RejectedFile {
            path: key,
            reason: RejectReason::NotAFile,
        });
        return;
    };
    if !meta.is_file() {
        rejected.push(RejectedFile {
            path: key,
            reason: RejectReason::NotAFile,
        });
        return;
    }
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !VIDEO_EXTENSIONS.contains(&ext.as_str()) {
        rejected.push(RejectedFile {
            path: key,
            reason: RejectReason::UnsupportedType,
        });
        return;
    }
    files.push(LocalVideo {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| key.clone()),
        path: key,
        size: meta.len(),
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let p = dir.join(name);
        fs::write(&p, bytes).unwrap();
        p
    }

    #[test]
    fn accepts_video_extensions_and_rejects_others() {
        let dir = tempfile::tempdir().unwrap();
        let mp4 = write(dir.path(), "a.MP4", b"x");
        write(dir.path(), "b.txt", b"x");
        write(dir.path(), "c.png", b"x");
        let mkv = write(dir.path(), "d.mkv", b"x");

        let r = scan(&[dir.path().to_path_buf()], &AtomicBool::new(false));
        assert_eq!(r.files.len(), 2);
        assert!(r.files.iter().any(|f| f.path == mp4.to_string_lossy()));
        assert!(r.files.iter().any(|f| f.path == mkv.to_string_lossy()));
        assert_eq!(r.rejected.len(), 2);
        assert!(
            r.rejected
                .iter()
                .all(|f| f.reason == RejectReason::UnsupportedType)
        );
    }

    #[test]
    fn dedupes_and_expands_nested_folders() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("sub");
        fs::create_dir(&sub).unwrap();
        let v = write(&sub, "v.webm", b"x");
        let r = scan(
            &[dir.path().to_path_buf(), v.clone()],
            &AtomicBool::new(false),
        );
        assert_eq!(r.files.len(), 1);
    }

    #[test]
    fn missing_path_is_rejected_not_panicked() {
        let r = scan(&[PathBuf::from("Z:/no/such/file.mp4")], &AtomicBool::new(false));
        assert_eq!(r.files.len(), 0);
        assert_eq!(r.rejected.len(), 1);
        assert_eq!(r.rejected[0].reason, RejectReason::NotAFile);
    }

    #[test]
    fn cancel_flag_truncates() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "a.mp4", b"x");
        write(dir.path(), "b.mp4", b"x");
        let cancel = AtomicBool::new(true);
        let r = scan(&[dir.path().to_path_buf()], &cancel);
        assert!(r.truncated);
    }
}
