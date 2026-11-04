# Clip Resizer — Arquitectura (validada)

Estado: **validada** (decisiones de la sección 10 resueltas el 2026-11-04). Lista para Fase 1.
Base: `docs/REFERENCE_PROJECT_ANALYSIS.md` (patrones verificados en Image Batch Studio, Seller Profit Calculator y PDF Toolbox Pro).

---

## 1. Insight central (lección de los tres proyectos)

En Image Batch los 11 módulos son **un solo `Job`**; en PDF Toolbox las ~10 herramientas son **un solo `PagePlan`**; en Profit Calculator los 11 módulos son **un solo `UnitScenario`**.

En Clip Resizer, Resize / Smart Crop / Background / Fit-Fill / Export son **una sola operación**:

```
RenderSpec = {
  input:  path del vídeo (+ metadatos ffprobe cacheados)
  canvas: { width, height }                    // lienzo de salida (preset o custom)
  fit:    Fill { offsetX, offsetY, zoom }      // crop/posición del vídeo en el canvas
        | Fit                                   // letterbox (usa background)
  background: None | Solid{color} | Blur{sigma,dim,scale}
            | Image{path, opacity, blur}
  guides_export: bool                          // safe zones quemadas en el vídeo (opt-in)
  export: { codec h264|h265, quality fast|balanced|high|custom{crf,preset},
            fps keep|24|25|30|50|60|custom, audio copy|aac|remove,
            resolution override?, bitrate? }
  output: { dir, name_template, conflict_policy rename|skip|overwrite_output }
}
```

Un `RenderSpec` se traduce de forma determinista a **un comando FFmpeg** (filtergraph + flags). Presets = `RenderSpec` parciales serializados en SQLite. Batch = `Vec<RenderSpec>` compartiendo canvas/fit/background/export. Preview honesto = el mismo filtergraph aplicado a 1 frame.

**Consecuencia:** no hay 4 motores; hay un constructor de filtergraphs (`cr-ffmpeg`) bien testeado y cuatro vistas UI que editan el mismo `RenderSpec`.

---

## 2. Stack (idéntico a la familia — sin inventar nada)

| Capa | Elección |
|---|---|
| Shell | Tauri 2 (WebView2), instalador NSIS (+MSI), `installMode: currentUser`, WebView2 bootstrapper |
| Frontend | React 19 + TS strict, Vite 7, Tailwind v4 (`@tailwindcss/vite`, tokens en `globals.css`), shadcn-style propio (Radix + cva + `cn()`), zustand 5, react-router-dom (hash), i18next (en/es/pt-BR + test de paridad), lucide-react, Inter Variable |
| Backend host | `src-tauri` capa fina: commands, validación de rutas, pool de procesos FFmpeg, eventos `Channel` agregados ~10 Hz |
| Motor | Rust puro en `crates/` (testeable con `cargo test`, sin Tauri) |
| Vídeo | **FFmpeg + FFprobe** como procesos externos (binarios en `vendor/ffmpeg`, fijados por versión+SHA-256) |
| BD | SQLite vía `rusqlite` bundled, migraciones append-only (`user_version`) |
| Tipos IPC | `ts-rs` → `src/lib/ipc/bindings/` |
| Calidad | Vitest + Testing Library, `cargo test`, ESLint 9, clippy `-D warnings`, `cargo-deny` (allowlist de licencias), ADRs en `docs/adr/` |

Prefijo de crates: **`cr-`** (clip resizer), igual que `ibs-`/`psc-`/`ptp-`.

---

## 3. FFmpeg: integración, seguridad y licencias comerciales

### 3.1 Distribución (patrón verificado: `fetch-pdfium.ps1`)

- `scripts/fetch-ffmpeg.ps1`: descarga el build **LGPL** de FFmpeg (gyan.dev publica variantes lgpl; la alternativa BtbN/FFmpeg-Builds también tiene variantes `-lgpl` pero compila `master` — peor para fijar versión estable). Versión fijada en el script + **SHA-256 verificado** + extracción a `vendor/ffmpeg/` (gitignored; nunca commiteado). Idempotente ("ya presente → salir").
- `tauri.conf.json` → `bundle.resources`: `vendor/ffmpeg/bin/ffmpeg.exe` y `ffprobe.exe` → `ffmpeg/` junto al ejecutable. El host los resuelve por ruta relativa al exe (mismo patrón que `worker_exe()` en ptp), con `CLIP_FFMPEG`/`CLIP_FFPROBE` env vars para desarrollo/tests.
- Tamaño: ~80–100 MB instalados (los dos exes). Aceptable para el instalador.

### 3.2 Licencias — decisión validada: build **LGPL** de FFmpeg

**Decisión del producto (validada):** se distribuirá el build **LGPL**, no GPL.

Consecuencias:

1. **Sin libx264 ni libx265** (ambos GPL). Los encoders H.264/H.265 pasan a ser los proporcionados por el SO/GPU, que el build LGPL sí soporta:
   - `h264_mf` / `hevc_mf` — Windows Media Foundation: presente en **todo** Win10/11, sin dependencia de GPU. Es el baseline garantizado; además Microsoft ya licencia su implementación H.264 → la ruta más limpia de patentes.
   - `h264_nvenc`/`hevc_nvenc` (NVIDIA), `h264_qsv`/`hevc_qsv` (Intel), `h264_amf`/`hevc_amf` (AMD) — se usan si el hardware existe.
   - Fallback software H.264: `libopenh264` (BSD) **si el build lgpl fijado lo incluye** — se verificará en Fase 1 con `ffmpeg -encoders`; si no, `h264_mf` cubre el 100 % de Windows.
2. **Matriz de encoders por capacidad, no por nombre** (`cr-ffmpeg`): al arrancar se parsea `ffmpeg -encoders` y se construye la lista de encoders H.264/HEVC disponibles en orden de preferencia (hw primero → openh264 → error claro). Los presets de calidad se mapean por encoder (`-rate_control`/quality para mf, `-cq`/`-preset` para nvenc, `-global_quality` para qsv) porque no existe `-crf` universal.
3. **Obligaciones LGPL** (más leves que GPL): texto LGPLv2.1 + atribución en `THIRD_PARTY_NOTICES` (Settings → About), oferta de fuentes de FFmpeg, y nada más: los binarios `.exe` no se enlazan — la app no deriva de FFmpeg en ningún caso.
4. Filtros necesarios (`scale`, `crop`, `pad`, `overlay`, `gblur`, `eq`, `fps`, `drawbox`/`drawgrid`, `split`) son todos LGPL → sin restricción.
5. Patent note honesta se mantiene en `KNOWN_ISSUES.md` (L6): preferir encoders del SO también es la ruta de menor exposición a MPEG-LA.

### 3.3 Ejecución controlada (patrón verificado: `worker_pool.rs` + `job_object.rs` de ptp)

`crates/cr-ffmpeg` envuelve los procesos:

- **Spawn** con argv (sin shell → Unicode/espacios seguros), `stdin` pipe (para enviar `q` = quit limpio), `stdout` = `-progress pipe:1 -nostats`, `stderr` capturado con ring buffer (últimas ~200 líneas → diagnóstico en `FileError`).
- **Windows Job Object por proceso** (código de `job_object.rs` reutilizable casi literal): `KILL_ON_JOB_CLOSE` — si la app muere o se cierra, el kernel mata todo FFmpeg en vuelo — + cap de memoria (p. ej. 4 GiB, revisar con 4K).
- **Progreso real** (regla: nunca simular): parseo de `out_time_us`/`total_size`/`speed`/`progress=continue|end` → `percent = out_time / duration_ffprobe`. Eventos al UI agregados con el mismo `forward_batched` (mpsc → `Channel` → ~10 Hz).
- **Cancelación**: enviar `q\n` a stdin (quit limpio) → si no muere en ~2 s, `kill()`. Temporal del job borrado. **Pausa: NO es técnicamente viable en FFmpeg** → se ofrece cancelar + reintentar; se documenta en lugar de simularla.
- **Timeout/watchdog** por job (configurable; renders no deberían exceder N×duración — watchdog de *progreso estancado*, no de tiempo absoluto).
- **Concurrencia**: FFmpeg ya paraleliza internamente → **1 render simultáneo por defecto**, configurable hasta `min(cores/4, 3)`; ffprobe/thumbnails en paralelo ligero aparte.
- **Fail-soft**: si faltan los binarios (dev sin fetch), la app abre y los comandos devuelven `missing_ffmpeg` claro (patrón ptp).

### 3.4 Filtergraphs (corazón del producto — cada uno con test dorado)

| Modo | Filtergraph (esquema) |
|---|---|
| Fill (crop) | `scale=W:H:force_original_aspect_ratio=increase,crop=W:H:x:y` (x,y,zoom desde Smart Crop) |
| Crop manual | `crop=sw·fx:sh·fy:x:y,scale=W:H` (fracciones del Smart Crop Studio) |
| Fit + sólido | `scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(W-iw)/2:(H-ih)/2:color=0xRRGGBB` |
| Fit + blur | `split[f][b];[b]scale=increase,crop=W:H,gblur=sigma=S,eq=brightness=-D[b2];[f]scale=decrease[f2];[b2][f2]overlay=(W-w)/2:(H-h)/2` |
| Fit + imagen | mismo overlay con `[1:v]` (`-loop 1 -i fondo`) escalado a cover |
| Safe zones quemadas (opt-in) | `drawbox`/`drawgrid` al final de la cadena |
| fps | `fps=N` explícito (nunca `-r` ambiguo) |
| Audio | `-c:a copy` (compatible MP4) | `-c:a aac -b:a 192k` | `-an` |
| Vídeo | matriz por capacidad: `h264_mf` (baseline universal Win10/11) → `h264_nvenc|qsv|amf` si hay GPU → `libopenh264` si el build lo trae; H.265 vía `hevc_mf|nvenc|qsv|amf`. Calidad mapeada por encoder (§3.2.2) |

Siempre re-encode de vídeo al cambiar geometría/fps (stream-copy solo cuando absolutamente nada cambia — MVP: nunca). `setsar=1` final para evitar SAR raros. `+faststart` en MP4 para publicación social.

### 3.5 Salida segura (patrón ADR-0004 de ptp, ya probado)

Render a `temp/<job-id>/out.mp4` → **verificación**: ffprobe de la salida (dimensiones == canvas, duración ≈ entrada ±0.5 s, decodable) → publicación: rename atómico mismo volumen / copia+fsync+verificación cross-volume → borrado del temporal. Output == input → rechazado siempre. `TempRoot` propio con barrido de huérfanos al arranque. Estimación de espacio en disco antes de empezar (bitrate objetivo × duración; si no hay, ×1.2 del input) con aviso, no con bloqueo.

---

## 4. Preview de vídeo — el riesgo técnico nº 1

WebView2 = Chromium de Edge: reproduce **H.264/AAC en MP4/M4V/MOV** y VP9/AV1 en WebM nativamente; **MKV, HEVC (según máquina), ProRes, algunos PCM** pueden no reproducirse.

Estrategia en dos niveles:

1. **Ruta directa**: `<video src=clipvid://...>` servido por `register_uri_scheme_protocol` (patrón `ptpthumb`) con soporte de range requests, whitelist de rutas tipo `viewable`.
2. **Proxy fallback**: si `<video>` emite `error` → generar proxy ligero en caché (`-vf scale=960:-2 -c:v h264_mf` — o el primer encoder H.264 disponible de la matriz — `-c:a aac`) en background y previsualizar el proxy; **el export siempre usa el original**. La UI lo indica ("vista previa aproximada").

**Composición en vivo sin FFmpeg:** el preview compone con DOM/CSS exactamente lo que hará el filtergraph:
- Fill/crop → `<video>` dentro de un contenedor con `overflow:hidden`, `transform: scale/translate` mapeado 1:1 a los parámetros del crop.
- Fit + fondo → **segundo `<video>` clonado** detrás, escalado a cover + `filter: blur(Npx) brightness(d)` (blur/dim reales, mismo tiempo de reproducción sincronizado), o color/imagen de fondo CSS.
- Safe zones → overlay SVG posicionado (tercios, centro, márgenes por plataforma) — nunca en el export salvo opt-in.
- **"Verificar frame real"**: botón que ejecuta el filtergraph real sobre 1 frame (`-ss t -frames:v 1`) y lo muestra → garantía de que CSS≈FFmpeg.

Miniaturas de la cola/imports: `ffmpeg -ss <t> -frames:v 1 -vf scale=320:-2` → caché en disco → `clipthumb://`.

Metadatos: `ffprobe -v error -print_format json -show_format -show_streams` → `VideoMeta{duration,width,height,fps,codec,bitrate,size,rotation,has_audio}`. Rotación (`displaymatrix`) se aplica al preview vía CSS y FFmpeg la consume automáticamente al re-encode.

---

## 5. Estructura de carpetas propuesta

```
clip-resizer/
├─ src/
│  ├─ app/modules.ts                    # NAV + flag `available` por módulo
│  ├─ components/layout/                # AppLayout, Sidebar, StatusBar, PageHeader
│  ├─ components/ui/                    # button, card, badge, select, slider, switch, segmented, input, tooltip
│  ├─ components/shared/                # DropZone, VideoPreview (+overlays), QueueList, PresetPicker, OutputPicker
│  ├─ features/
│  │  ├─ dashboard/                     # resumen + últimos renders
│  │  ├─ studio/                        # workspace principal: import → preset → crop → background → export
│  │  │   ├─ StudioPage.tsx  panels/    # CropPanel, BackgroundPanel, ExportPanel (vistas del mismo RenderSpec)
│  │  ├─ queue/                         # Batch Processing (cola, estados, progreso por ítem)
│  │  ├─ presets/  history/  settings/
│  │  └─ onboarding/
│  ├─ lib/ipc/ (+bindings/)             # ipc.ts + ts-rs
│  ├─ stores/                           # queue.ts, settings.ts, license.ts, studio.ts (RenderSpec en edición)
│  ├─ i18n/locales/{en,es,pt-BR}.json
│  └─ styles/globals.css                # tokens --cr-*, .dark/.light, @theme inline
├─ src-tauri/src/
│  ├─ commands/{app,files,probe,jobs,presets,settings,license}.rs
│  ├─ ffmpeg_pool.rs                    # cola de procesos, concurrencia, cancelación
│  ├─ job_object.rs                     # (reuso patrón ptp) kill-on-close + mem cap
│  ├─ thumbnails.rs  state.rs  error.rs  temp.rs
│  └─ tauri.conf.json + capabilities/   # CSP estricta, permisos mínimos
├─ crates/
│  ├─ cr-model/                         # RenderSpec, VideoMeta, presets, eventos, errores (ts-rs)
│  ├─ cr-ffmpeg/                        # binarios vendor, ffprobe, filtergraph builder, runner, progress parser
│  ├─ cr-files/                         # intake (carpetas→vídeos, firma+ext), TempRoot, rutas seguras, espacio en disco
│  ├─ cr-store/                         # SQLite + migraciones: settings, presets, render_history, license
│  ├─ cr-license/                       # Policy Free/Pro (JobShape→LimitViolation) + activación (patrón ibs)
│  └─ cr-cli/                           # CLI de pruebas/benchmarks (no se distribuye)
├─ scripts/fetch-ffmpeg.ps1             # versión+SHA-256 fijados → vendor/ffmpeg
├─ tests/fixtures/                      # vídeos generados por script (vertical/horizontal/cuadrado/sin audio/fps varios)
├─ docs/{ARCHITECTURE→este doc renombrado, CHECKLIST.md, adr/, REFERENCE_PROJECT_ANALYSIS.md, DEVELOPMENT_PROGRESS.md, KNOWN_ISSUES.md}
└─ .github/workflows/                   # lint, tests, build Windows (en fase 6)
```

### Navegación propuesta (difiere deliberadamente del spec, con justificación)

El spec sugiere Smart Crop y Background Studio como entradas de sidebar separadas. Siguiendo la lección de los tres proyectos (los módulos son **vistas** sobre un modelo, no operaciones distintas), propongo:

- **Dashboard** — resumen, renders recientes, estado de licencia.
- **Studio** — el workspace único: importar vídeo → preset de formato → ajustar encuadre (Smart Crop) → fondo (Background Studio) → exportar. Crop y Background son *paneles* de esta pantalla editando el mismo `RenderSpec`; separarlos duplicaría import/preview/export.
- **Queue** — Batch Processing: aplicar el RenderSpec actual a N vídeos, estados, progreso real, cancelar/reintentar.
- **Presets** — crear/editar/favoritos (guardan `RenderSpec` parciales en SQLite).
- **History** — export history desde `render_history`.
- **Settings** — tema, idioma, concurrencia, rutas por defecto, licencia, About.

*(Si se prefiere la navegación del spec literal, es viable: Smart Crop y Background serían vistas del mismo RenderSpec compartido vía `stores/studio.ts`. Se decide en la validación.)*

---

## 6. Modelo de jobs y eventos IPC

```rust
RenderJob { id, spec: RenderSpec, input_meta: VideoMeta }
JobState = Pending | Probing | Rendering{pct, fps, speed} | Verifying | Done{out, bytes}
        | Failed{code,message,ffmpeg_tail} | Cancelled
QueueEvent = Snapshot(Vec<ItemState>) | ItemUpdate{id, state} | Finished{summary}
            // ~10 Hz agregado, igual que forward_batched
```

- `scan_inputs(paths)` → expande carpetas, valida extensión + firma, devuelve aceptados/rechazados (`ScanResult` patrón).
- `probe(paths)` → ffprobe en paralelo ligero → `VideoMeta` + thumbnail programada.
- `start_queue(specs)` / `cancel_queue()` / `retry_item(id)` / `remove_item(id)`.
- `preview_frame(spec, t)` → PNG del frame con el filtergraph real.
- `plan_check(shape: JobShape)` → `LimitViolation[]` antes de exportar (en backend, nunca solo en UI).

---

## 7. Free / Pro (patrón `ptp-license` + activación `ibs`)

`Policy::standard()` declarativa — **valores iniciales, editables en un solo sitio**:

| Límite (`ToolLimits`-like) | Free | Pro |
|---|---|---|
| `max_files_per_job` | 1 (no batch) | ilimitado |
| `max_output_height` | 1080 | ilimitado |
| `background_modes` | Fit+Fill solamente | todos (blur, imagen) |
| `custom_presets` | no | sí |
| `safe_zone_export` | no | sí |
| `advanced_quality` (parámetros de encoder/bitrate custom, h265) | no | sí |
| `watermark` | sin marca de agua (Free realmente útil) | — |

`JobShape{files, max_output_h, features: FeatureSet}` → `Policy::check` → `LimitViolation{kind,limit,actual}` mostrado en UI con upgrade prompt honesto. Sin licencia = Free, nunca bloqueo, nunca toca archivos. Activación: reutilizar el diseño de `src-tauri/src/license.rs` de ibs (trial opt-in + Lemon Squeezy + claves firmadas Ed25519 + gracia offline) en `cr-license` — no inventar uno nuevo.

---

## 8. Riesgos técnicos identificados

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | WebView2 no reproduce MKV/HEVC/ProRes/etc. | Proxy automático en caché (§4); indicador "preview aproximada" |
| 2 | Licencia FFmpeg en producto comercial | Build **LGPL** (decisión validada) como proceso separado + notices + oferta de fuente; encoders HW del SO preferidos (§3.2); revisión legal pre-lanzamiento |
| 2b | Sin x264: calidad/control de rate inferior en encoders HW | Baseline `h264_mf` universal; presets de calidad mapeados por encoder con parámetros documentados; "verificar frame real" muestra la calidad real |
| 3 | FFmpeg huérfano tras cierre/crash | Job Object `KILL_ON_JOB_CLOSE` (patrón ptp probado) |
| 4 | Progreso falso/engañoso | `-progress pipe:` parseado; pct = out_time/duración real; nunca interpolar |
| 5 | Pausa solicitada en spec | No existe en FFmpeg → cancel+retry documentado, no simulado |
| 6 | Preview CSS ≠ salida FFmpeg | Botón "verificar frame real" ejecuta el filtergraph sobre 1 frame |
| 7 | Rotación/metadatos (displaymatrix, VFR, HDR) | ffprobe lee rotación → CSS + ffmpeg auto; HDR: MVP documenta posible desaturación, `zscale/tonemap` en fase posterior |
| 8 | Espacio en disco insuficiente | Estimación previa + temp en volumen de caché + error claro |
| 9 | Renders largos bloquean lotes | 1 proceso en vuelo, watchdog de progreso estancado, cancel granular por ítem |
| 10 | Archivos enormes en memoria | Nunca se carga vídeo en memoria: ffmpeg lee/escribe streams; preview por ruta/range |
| 11 | Rutas Unicode/espacios | argv sin shell; canonicalización; tests con fixtures de nombres hostiles |
| 12 | SmartScreen/instalador | Mismo estado que la familia: bootstrapper WebView2, certificado de firma pendiente (decisión comercial) |

---

## 9. Plan de fases (alineado al spec, ajustado a esta arquitectura)

| Fase | Contenido | Criterio de salida |
|---|---|---|
| 1 Foundation | scaffold (stack idéntico), tokens/tema/i18n, modules.ts con `available:false`, fetch-ffmpeg.ps1, cr-files scan, ffprobe metadata+thumbs, protocolo clipvid/clipthumb | Importar vídeos (incl. carpeta/DnD), ver metadatos+thumbnail, reproducir H.264 en preview |
| 2 Core Resizer | presets de aspecto, Fill/Fit/Solid, RenderSpec→filtergraph, export MP4 H.264, salida segura+verificación, preview CSS+check-frame | Importar → adaptar → exportar MP4 verificado |
| 3 Background Studio | blur/solid/imagen + ajustes, preview en vivo, crop manual (Smart Crop panel) | Vertical↔horizontal sin perder contenido |
| 4 Batch | cola (Queue), concurrencia 1..N, progreso real, cancel/retry/remove, render_history | Procesar N vídeos sin intervención |
| 5 Safe Zones + Export avanzado | guías overlay (+export opt-in), presets custom, fps/bitrate/h265/HW encoders, Policy Free/Pro conectada | Límites Free funcionando en backend |
| 6 Polish | licencia (activación), instalador NSIS, iconos/branding, THIRD_PARTY_NOTICES, fixtures de test, docs de usuario | Build instalable y testeado |

---

## 10. Decisiones de validación — RESUELTAS (2026-11-04)

1. **Navegación consolidada**: Studio único; Smart Crop y Background Studio son paneles del mismo `RenderSpec`. Sidebar: Dashboard · Studio · Queue · Presets · History · Settings.
2. **FFmpeg: build LGPL** distribuido como proceso separado + notices + oferta de fuente. Estrategia de encoders por matriz de capacidad (§3.2); baseline `h264_mf` universal.
3. **Identidad: acento propio** para Clip Resizer (tokens `--cr-*`, misma estructura que la familia).
4. **Free sin marca de agua** en exportaciones.
5. **Concurrencia por defecto 1 render**, configurable 1–3 en Settings (pendiente solo de implementar).
