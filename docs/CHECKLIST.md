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

## Fase 2 — Core Video Resizer ⬜

- [ ] `RenderSpec` en cr-model (canvas, fit fill/fit, export)
- [ ] Presets de aspecto (9:16, 1:1, 4:5, 16:9, 4:3, 3:4, custom)
- [ ] Filtergraph builder fill/fit + tests dorados
- [ ] Matriz de encoders por capacidad (h264_mf→hw→openh264)
- [ ] Export MP4 con progreso real (`-progress pipe:`)
- [ ] Salida segura temp→verificar→rename
- [ ] Preview CSS del encuadre + "verificar frame real"

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
