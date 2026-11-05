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

---

## Fase 1 — Foundation (completada)

**Fecha:** 2026-11-04

### Implementado

- Scaffold completo idéntico a la familia (Tauri 2 + React 19 + TS strict + Vite 7 + Tailwind 4 + shadcn-style + zustand + hash-router + i18n en/es/pt-BR + lucide + Inter).
- Design tokens `--cr-*` con acento propio ámbar + temas dark/light.
- Workspace Cargo: `cr-model` (tipos ts-rs), `cr-files` (scan), `cr-ffmpeg` (binarios/probe/thumbnail), `cr-store` (SQLite+migraciones+Settings), `src-tauri` (capa fina).
- `scripts/fetch-ffmpeg.ps1`: FFmpeg **LGPL** n9.0.2-47-gb204e94e90 (BtbN autobuild-2026-11-04-12-51) con SHA-256 fijado `b0c31bfb...2909c`. Verificado: incluye `h264_mf`, `hevc_mf`, `libopenh264`, `libkvazaar` y todos los encoders hw.
- `clipvid://` protocolo con **HTTP Range real** (seek en `<video>`) + whitelist `viewable`.
- `clipthumb://` caché de miniaturas PNG.
- Studio funcional: importar (diálogo + drag&drop nativo de Tauri), lista virtualizada con miniaturas lazy + metadatos (ffprobe batched en 4 hilos), preview `<video>` + ficha de metadatos, reveal en carpeta.
- Dashboard con estado real de FFmpeg; Settings con tema/idioma/concurrencia/carpeta de salida/About.
- Iconos de aplicación generados (ámbar sobre fondo oscuro).

### Verificación ejecutada

- `cargo test --workspace`: **28 tests ok** (scan, ffprobe-parse, protocolo range, store).
- `cargo clippy --workspace --all-targets`: **0 warnings**.
- `npx vitest run`: **13 tests ok** (paridad i18n, format, resolveLocale).
- `tsc -b --noEmit`, `eslint .`, `vite build`: limpios.
- E2E manual con binarios: h264 encode + ffprobe JSON + thumbnail = ok.

### Limitaciones conocidas (Phase 1)

- Preview `<video>` solo reproduce lo que WebView2 soporta (H.264/AAC ok; MKV/HEVC pueden fallar → proxy en fase posterior; la UI ya lo anuncia con `cannotPlay`).
- Sin jobs de render todavía: StatusBar muestra importación, no progreso de render.
- `render_history` existe como tabla pero aún no se escribe.

### Siguiente fase

Fase 2 — Core Video Resizer (`RenderSpec`, presets de aspecto, filtergraph fill/fit, matriz de encoders, export MP4 con progreso real, salida segura, preview del encuadre).

---

## Fase 2 — Core Video Resizer (completada)

**Fecha:** 2026-11-04

### Implementado

- `RenderSpec` único (canvas / FitSpec{Fill{offset,zoom} | Fit} / Background{Solid|Blur} / ExportSpec{codec,quality,fps,audio}) → un comando FFmpeg determinista.
- Filtergraph builder con 7 tests dorados. Nota: `eq` es filtro **GPL-only** — se reemplazó por `lutyuv` para oscurecer el fondo blur (verificado contra el build LGPL vendored).
- Matriz de encoders: nvenc→qsv→amf→h264_mf→libopenh264 (h264) / …→hevc_mf→libkvazaar (hevc). Calidad: nvenc -cq; resto CBR por bpp.
- `run_render`: `-progress pipe:1` real → eventos ~10 Hz via Channel (patrón ibs forward_batched); cancel `q`→kill 2s; Job Object (kill-on-close + 4GiB cap).
- Salida segura: `*.clipresizer-tmp` → verify_output (ffprobe: geometría exacta + duración ±5%/1.5s) → rename atómico; política rename/skip/overwrite; nunca sobreescribe el input.
- UI Studio: presets visuales de aspecto + custom, panel Framing (fill: zoom+pan sliders; fit: solid color/blur sigma+dim), panel Export (codec/quality/fps/audio + encoder resuelto honesto), preview compuesto CSS fiel al grafo + botón verify que renderiza 1 frame real.
- E2E verificado: 1920×1080@30 h264 → 1080×1920 blur-fit, h264_mf, yuv420p, faststart.

### Verificación

- 47 cargo tests, 13 vitest, clippy 0 warnings, tsc/eslint/vite build limpios.

### Siguiente fase

Fase 3 — Background Studio completo (imagen de fondo, crop manual con máscara, separación visual).
---

## Fase 3 — Background Studio (completada)

**Fecha:** 2026-11-04

- `Background::Image{path,blur}` (segundo input `-loop 1`), margin 0-40% + border px/color en el fg (separación visual) — ambos en el grafo y en el preview CSS.
- UI: selector de fondo Blur/Solid/Image, selector de imagen (diálogo), sliders de margin/border/color.
- Tests + checks verdes; build ok.

### Siguiente fase

Fase 4 — Batch Processing (cola, concurrencia, progreso por item, cancel/retry, historial).
---

## Fase 4 — Batch Processing (completada)

**Fecha:** 2026-11-04

- `commands/queue.rs`: cola compartida con worker único guardiado por AtomicBool (toque bajo el mismo lock → sin lost-wakeup), ids u32, retry respawnea worker.
- Eventos `QueueEvent` (Snapshot/Item) por Channel a ~10 Hz; cancel coopera en pending y running; temp→verify→rename por item; history escrita en SQLite.
- UI: Queue page (badge de estado, barra de progreso, reveal/retry/remove), botón "Queue all" en Studio que encola todos los listos con el spec actual.
- Concurrencia fija a 1 worker de momento (honesto: la exportación ya usa ffmpeg externo; el campo settings.concurrent_renders se reservará para fase posterior con N workers).
- Verificación: 47 cargo tests + 13 vitest + typecheck/lint/build/clippy limpios.

### Siguiente fase

Fase 5 — Safe Zones + Export avanzado (guías overlay, presets custom, fps/bitrate/H.265, Policy Free/Pro).
---

## Fase 5 — Safe Zones + Export avanzado (completada)

**Fecha:** 2026-11-05

- `Guides{safe,thirds,center,export}` en RenderSpec: overlays SVG fieles en preview + quemado opt-in con drawbox (verificado LGPL).
- ExportSpec.bitrate_kbps override manual; encoder CBR lo respeta.
- `policy.rs`: Policy Free/Pro declarativa con tests; límites Free: canvas ≤1080×1920, solo H.264, sin imagen de fondo, sin bitrate custom, sin guides quemadas, batch ≤1, sin presets. Errores `pro_required:code`.
- `settings.edition` (free/pro) como selector temporal hasta activación de licencia real en Fase 6.
- Tabla `presets` (migración v3) + save/list/delete + PresetsPage real con aviso Free.
- Fix Phase 4: render_history SQL alineado al esquema real (at/ok/failed/bytes_out/output_dir/meta JSON).
- Verificación: 55 cargo tests, 13 vitest, clippy/typecheck/lint/build limpios.

### Siguiente fase

Fase 6 — Commercial Polish (licencia real, THIRD_PARTY_NOTICES, instalador, History page, fixtures).
---

## Fase 6 — Commercial Polish (parcial)

**Fecha:** 2026-11-05

- `THIRD_PARTY_NOTICES.md`: FFmpeg LGPL (build+SHA-256, ruta de fuente), tabla de licencias de deps.
- `icon.icns` generado; installer NSIS/MSI configurado con ffmpeg empaquetado en `ffmpeg/`.
- HistoryPage: filas reales de render_history (nombre, origen, fecha, bytes, estado, reveal).
- `scripts/make-fixtures.ps1`: 7 vídeos de test (1080p/9:16/1:1/4:5/720p/4:3@15fps/rotado) vía lavfi; test de integración `probes_and_thumbnails_real_fixtures` los ejercita.
- Fixes: `bitrate_kbps` ts-rs → number (no bigint); clave dinámica en GuidesPanel; gitignore fixtures.

### Pendiente honesto

- Licencia real (Lemon Squeezy + Ed25519) — la infraestructura Policy/Edition ya existe.
- Firma de código — requiere certificado comercial; SmartScreen warning documentado.
- Licencia de fuentes/third-party review completo en release.