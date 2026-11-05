# Third-Party Notices — Clip Resizer

Clip Resizer bundles the following third-party software. This file ships
with the application installer.

## FFmpeg / FFprobe (LGPL v2.1+)

- **What**: `ffmpeg.exe` + `ffprobe.exe`, executed as separate child
  processes. Clip Resizer does not link FFmpeg libraries.
- **Build**: BtbN Windows autobuild `ffmpeg-n9.0.2-47-gb204e94e90-win64-lgpl-9.0`
  (release `autobuild-2026-11-04-12-51`), SHA-256 pinned and verified by
  `scripts/fetch-ffmpeg.ps1`.
- **License**: GNU Lesser General Public License v2.1 or later
  (the `--enable-gpl` / `--enable-nonfree` flags are **not** used; no
  libx264, libx265, fdk-aac or other GPL/nonfree components are included).
- **License text**: `vendor/ffmpeg/LICENSE.txt` (ships alongside the
  binaries in the installed `ffmpeg/` folder).
- **Source offer**: Corresponding source for the exact build is available
  from the upstream project:
  - Build system & patches: https://github.com/BtbN/FFmpeg-Builds
  - FFmpeg source: https://ffmpeg.org/download.html (tag `n9.0.2`)

If you need the corresponding source from us, contact support and we will
provide it per LGPL §6.

## Other components

| Component | License | Notes |
|---|---|---|
| Tauri framework | MIT / Apache-2.0 | App shell |
| Rust crates (serde, rusqlite+SQLite, thiserror, ts-rs, windows-sys, sha2, anyhow, tempfile…) | MIT / Apache-2.0 (SQLite: public domain) | See `Cargo.lock` |
| npm packages (React, Vite, Tailwind, zustand, i18next, lucide-react, Radix, react-router…) | MIT / ISC | See `package-lock.json` |
| Inter font | SIL OFL 1.1 | @fontsource packages |

Media Foundation / GPU vendor encoders (`*_mf`, `nvenc`, `qsv`, `amf`) are
provided by the operating system / drivers; patent licensing for the
codecs they produce is the responsibility of the platform vendor under
their own terms.
