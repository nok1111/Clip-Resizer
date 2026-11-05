# Clip Resizer — Development Checklist

## Fase 1 — Foundation ✅

- [x] Scaffold (Tauri 2 + React 19 + TS strict + Vite 7 + Tailwind 4 + shadcn-style + zustand + hash-router + i18n)
- [x] Design tokens `--cr-*` con acento propio (ámbar) + tema dark/light
- [x] `src/app/modules.ts` con flag `available` (Studio=true; Queue/Presets/History=false)
- [x] Layout Sidebar + StatusBar + PageHeader
- [x] i18n en/es/pt-BR + test de paridad
- [x] `scripts/fetch-ffmpeg.ps1` (versión + SHA-256 fijados → `vendor/ffmpeg`, gitignored)
- [x] FFmpeg LGPL n9.0.2 (BtbN) verificado: `h264_mf`, `hevc_mf`, `libopenh264`, `libkvazaar`, hw encoders
- [x] `cr-files`: scan de archivos/carpetas (extensión + legibilidad, dedupe, cap, cancel)
- [x] `cr-ffmpeg`: localización de binarios vendor, `probe`/`probe_many` (ffprobe JSON→VideoMeta), `thumbnail`, `version`
- [x] `cr-store`: SQLite + migraciones append-only + Settings (validación + parse lenient)
- [x] `cr-model`: tipos ts-rs → `src/lib/ipc/bindings/` (TS_RS_EXPORT_DIR en .cargo/config.toml)
- [x] Comandos: app_info, settings get/save/reset, scan_inputs, probe_videos, video_thumbnail, reveal_path, pick_output_dir, open_output_dir
- [x] `clipvid://` protocolo con HTTP Range (whitelist `viewable`) — reproduce vídeo en `<video>`
- [x] `clipthumb://` protocolo (caché PNG por sha256 path|size|mtime|seek|target)
- [x] Studio: importar (diálogo + drag&drop), lista virtualizada con thumbs lazy + metadatos, preview `<video>` + ficha de metadatos, reveal en carpeta
- [x] Settings: tema, idioma, renders concurrentes, carpeta de salida, About (versión app+ffmpeg)
- [x] Dashboard con estado real de FFmpeg
- [x] Tests: 28 cargo tests + 13 vitest — todo verde; clippy -D warnings limpio; tsc + eslint + vite build limpios

## Fase 2 — Core Video Resizer ✅

- [x] `RenderSpec` en cr-model (canvas, FitSpec fill{offset,zoom}/fit, Background solid/blur, ExportSpec)
- [x] Presets de aspecto (9:16, 1:1, 4:5, 16:9, 4:3, 3:4, custom) con selector visual
- [x] Filtergraph builder fill/fit + 7 tests dorados; `eq`→`lutyuv` (eq es GPL-only)
- [x] Matriz de encoders por capacidad (nvenc→qsv→amf→mf→openh264/kvazaar)
- [x] Export MP4 con progreso real (`-progress pipe:1` ~10Hz), speed, tamaño
- [x] Salida segura tmp→verificar(ffprobe geom+duración)→rename atómico; conflict rename/skip/overwrite; nunca sobreescribe el input
- [x] Job Object (kill-on-close + cap 4GiB); cancel `q`+kill
- [x] Preview compuesto CSS (fill pan/zoom, fit solid, fit blur) + botón verify → frame real vía ffmpeg
- [x] E2E real: 1920x1080 → 1080x1920 blur-fit h264_mf yuv420p

## Fase 3 — Background Studio ⬜

- [ ] Blur/solid/imagen + ajustes
- [ ] Crop manual (Smart Crop panel) con offset/zoom
- [ ] Preview en vivo (segundo `<video>` blurreado)

## Fase 4 — Batch Processing ⬜

- [ ] Cola (Queue), concurrencia, progreso real, cancel/retry/remove
- [ ] render_history en SQLite + Dashboard

## Fase 5 — Safe Zones + Export avanzado ⬜

- [ ] Guías overlay (+export opt-in)
- [ ] Presets custom, fps/bitrate/H.265
- [ ] Policy Free/Pro en backend

## Fase 6 — Commercial Polish ⬜

- [ ] Licencia (activación Lemon Squeezy + claves firmadas)
- [ ] THIRD_PARTY_NOTICES, instalador NSIS, iconos finales
- [ ] Fixtures de test, docs de usuario
