//! `clipvid://` — serves whitelisted video files to `<video>` elements with
//! HTTP Range support (seeking requires it; without Content-Range Chromium
//! refuses to seek). Only files in `state.viewable` are ever served.

use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use tauri::http::{Request, Response};
use tauri::Manager;

use crate::state::AppState;

/// Max bytes served per request (Chromium requests bounded ranges anyway).
const MAX_CHUNK: u64 = 16 * 1024 * 1024;

pub fn handle_video(
    ctx: &tauri::UriSchemeContext<'_, tauri::Wry>,
    req: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let state = ctx.app_handle().state::<AppState>();
    let Some(path) = decode_path(req.uri().path()) else {
        return error(400, "bad path");
    };
    let allowed = state
        .viewable
        .lock()
        .map(|v| v.contains(&path))
        .unwrap_or(false);
    if !allowed {
        return error(403, "file is not part of the imported set");
    }
    serve_range(&path, req.headers().get("range").and_then(|v| v.to_str().ok()))
}

fn decode_path(raw: &str) -> Option<PathBuf> {
    let raw = raw.trim_start_matches('/');
    let decoded = percent_decode(raw)?;
    if decoded.is_empty() || decoded.contains("..") {
        return None;
    }
    Some(PathBuf::from(decoded))
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return None;
            }
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .as_deref()
    {
        Some("mp4") | Some("m4v") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("webm") => "video/webm",
        Some("mkv") => "video/x-matroska",
        Some("avi") => "video/x-msvideo",
        _ => "application/octet-stream",
    }
}

fn serve_range(path: &Path, range: Option<&str>) -> Response<Vec<u8>> {
    let Ok(mut f) = std::fs::File::open(path) else {
        return error(404, "file not found");
    };
    let Ok(len) = f.metadata().map(|m| m.len()) else {
        return error(404, "file not found");
    };

    let (mut start, mut end) = (0u64, len.saturating_sub(1));
    let mut partial = false;
    if let Some(range) = range.and_then(|r| r.strip_prefix("bytes=")) {
        let mut it = range.splitn(2, '-');
        let s = it.next().unwrap_or("");
        let e = it.next().unwrap_or("");
        if let Ok(v) = s.parse::<u64>() {
            start = v.min(len.saturating_sub(1));
        } else if let Ok(suffix) = e.parse::<u64>() {
            // "bytes=-N" = last N bytes.
            start = len.saturating_sub(suffix);
        }
        if let Ok(v) = e.parse::<u64>() {
            if !s.is_empty() {
                end = v.min(len.saturating_sub(1));
            }
        }
        partial = true;
    }
    end = end.min(start + MAX_CHUNK - 1).min(len.saturating_sub(1));
    let count = end.saturating_sub(start) + 1;

    let mut buf = vec![0u8; count as usize];
    let body = match f.seek(SeekFrom::Start(start)).and_then(|_| f.read_exact(&mut buf)) {
        Ok(()) => buf,
        Err(_) => return error(416, "range not satisfiable"),
    };

    let builder = Response::builder()
        .header("Content-Type", mime_for(path))
        .header("Accept-Ranges", "bytes")
        .header("Content-Length", count.to_string());
    if partial {
        builder
            .status(206)
            .header("Content-Range", format!("bytes {start}-{end}/{len}"))
            .body(body)
            .unwrap()
    } else {
        builder.status(200).body(body).unwrap()
    }
}

fn error(status: u16, msg: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", "text/plain")
        .body(msg.as_bytes().to_vec())
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_decodes_windows_paths() {
        let p = decode_path("/C%3A%5CUsers%5Cme%5Cvideo%201.mp4").unwrap();
        assert_eq!(p, PathBuf::from("C:\\Users\\me\\video 1.mp4"));
    }

    #[test]
    fn rejects_traversal_and_bad_encoding() {
        assert!(decode_path("/..%2Fetc%2Fpasswd").is_none());
        assert!(decode_path("/%zz").is_none());
        assert!(decode_path("/%").is_none());
    }

    #[test]
    fn serves_full_and_partial_ranges() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("v.mp4");
        std::fs::write(&p, vec![7u8; 1000]).unwrap();

        let r = serve_range(&p, None);
        assert_eq!(r.status(), 200);
        assert_eq!(r.body().len(), 1000);

        let r = serve_range(&p, Some("bytes=100-199"));
        assert_eq!(r.status(), 206);
        assert_eq!(r.body().len(), 100);
        assert_eq!(
            r.headers().get("Content-Range").unwrap(),
            "bytes 100-199/1000"
        );

        // Suffix range "bytes=-100" → last 100 bytes.
        let r = serve_range(&p, Some("bytes=-100"));
        assert_eq!(r.status(), 206);
        assert_eq!(r.body().len(), 100);

        // Out-of-range end is clamped.
        let r = serve_range(&p, Some("bytes=990-5000"));
        assert_eq!(r.status(), 206);
        assert_eq!(r.body().len(), 10);
    }
}
