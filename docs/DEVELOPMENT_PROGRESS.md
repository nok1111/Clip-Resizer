# Clip Resizer — Development Progress

## Fase 0 — Reference Analysis (completada y validada)

**Fecha:** 2026-11-04

### Hecho

- Inspeccionados los tres proyectos de referencia (solo lectura):
  - `Desktop/image-batch-studio/image-batch-studio`
  - `Desktop/profit-analizer/Profit Analyzer`
  - `Desktop/pdf-toolbox-pro/PDF Toolbox Pro`
- Verificados package.json, Cargo.toml, tauri.conf.json, código fuente real (no solo READMEs), docs/ARCHITECTURE.md y ADRs de cada proyecto.

### Archivos creados

- `docs/REFERENCE_PROJECT_ANALYSIS.md` — análisis completo de los tres proyectos.
- `docs/CLIP_RESIZER_ARCHITECTURE.md` — arquitectura propuesta (pendiente de aprobación).
- `docs/DEVELOPMENT_PROGRESS.md` — este archivo.
- `docs/KNOWN_ISSUES.md` — registro de limitaciones conocidas.

### Hallazgos clave

- Los tres proyectos comparten un stack idéntico (Tauri 2 + React 19 + TS strict + Vite 7 + Tailwind 4 + shadcn-style + zustand + hash-router + i18n en/es/pt-BR + rusqlite + ts-rs). Clip Resizer lo adoptará sin cambios.
- El modelo "worker process + JSON-lines + Job Object + temp root" de PDF Toolbox encaja directamente con FFmpeg como proceso externo.
- El patrón `fetch-<bin>.ps1` (versión + SHA-256 fijados → `vendor/`) resuelve la distribución comercial de FFmpeg.
- La licencia Free/Pro combina la `Policy` declarativa de ptp-license con la activación de ibs (Lemon Squeezy + claves firmadas + gracia offline).

### Pruebas ejecutadas

N/A — fase documental. Ningún proyecto de referencia fue modificado.

### Decisiones validadas (2026-11-04)

- Navegación: **Studio único** (Crop/Background como paneles del mismo RenderSpec).
- FFmpeg: **build LGPL** como proceso separado; matriz de encoders por capacidad (`h264_mf` baseline universal → nvenc/qsv/amf → openh264 si el build lo trae).
- Identidad: **acento propio** con tokens `--cr-*`.
- Free: **sin marca de agua**.

### Siguiente fase

Fase 1 — Foundation (scaffold, tema/i18n, fetch-ffmpeg.ps1, scan, ffprobe, thumbnails, preview).
