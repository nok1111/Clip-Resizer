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

## Fase 3 — Background Studio ✅

- [x] Blur/solid/imagen + ajustes (blur sigma/dim, color, imagen + blur opcional)
- [x] Separación visual: margin (0-40%) + border px/color en el fg
- [x] Preview en vivo: segundo `<video>` blurreado o `<img>` para fondo imagen
- [ ] Crop manual libre (drag-to-crop con máscara) → diferido: Fill con pan/zoom cubre el caso principal

## Fase 4 — Batch Processing ✅

- [x] Cola backend compartida (VecDeque + worker guard atómico, sin lost-wakeup)
- [x] enqueue_render por Channel (~10Hz/item), progreso real, cancel (pending+running), retry, remove
- [x] Queue page real: lista con %, badges de estado, reveal, retry/remove
- [x] Studio "Queue all" → encola todos los items listos con el spec actual
- [x] render_history SQLite escrita por item terminado + comando render_history

## Fase 5 — Safe Zones + Export avanzado ✅

- [x] Guías overlay (safe 5%, tercios, centro) en preview + export opt-in vía drawbox (LGPL)
- [x] Presets custom persistidos en SQLite (tabla presets, migración v3) + PresetsPage save/apply/delete
- [x] Bitrate override manual, fps/codec/quality ya presentes, H.265 con libkvazaar/hw
- [x] Policy Free/Pro declarativa en backend: canvas≤1080x1920, solo H.264, sin bg imagen, sin bitrate custom, sin guides quemadas, batch=1, sin presets — errores pro_required
- [x] settings.edition (free/pro) temporal hasta licencia (Fase 6); History sigue pendiente

## Fase 6 — Commercial Polish (parcial)

- [x] THIRD_PARTY_NOTICES.md (FFmpeg LGPL, build+hash, oferta de fuente, tabla de deps)
- [x] Iconos completos (.ico multi-size, .icns, PNGs)
- [x] HistoryPage con datos reales de render_history (reveal, bytes, fecha, estado)
- [x] tests/fixtures/videos: matriz de 7 vídeos sintéticos (make-fixtures.ps1, gitignored) + test de integración probe+thumbnail real
- [x] Instalador NSIS configurado (targets nsis+msi, ffmpeg resources empaquetados, currentUser)
- [ ] Licencia real (Lemon Squeezy + claves Ed25519) — pendiente
- [ ] Firma de código (necesita certificado) — documentado
