# Reference Project Analysis — Clip Resizer (Fase 0)

Estado: **análisis completado, pendiente de aprobación de arquitectura**.

Proyectos inspeccionados (solo lectura, no modificados):

| Proyecto | Ruta local | Estado según CHECKLIST |
|---|---|---|
| Image Batch Studio | `Desktop/image-batch-studio/image-batch-studio` | Avanzado: 20/23 ítems marcados; 11 módulos implementados (`available: true`), licencias, historial, onboarding |
| Seller Profit Calculator | `Desktop/profit-analizer/Profit Analyzer` (repo `Profit-Analyzer`) | Completado: 16/16 ítems |
| PDF Toolbox Pro | `Desktop/pdf-toolbox-pro/PDF Toolbox Pro` | Fase 1–2 en curso: 2/13 ítems; arquitectura aprobada, worker pool + herramientas básicas implementadas |

> Nota: existe también `Desktop/Profit-Analyzer` (mismo proyecto, copia) — se analizó la copia dentro de `profit-analizer/`.

---

## 1. Tecnologías y versiones (verificadas en package.json / Cargo.toml)

Los tres proyectos comparten **exactamente el mismo stack**. Es la stack de la familia de productos.

### Frontend

| Uso | Librería | Versión |
|---|---|---|
| Shell | Tauri 2 (`@tauri-apps/api`, `@tauri-apps/cli`) | ^2.12.4 |
| UI | React + React DOM | ^19.3.1 |
| Lenguaje | TypeScript (strict, `tsc -b`) | ~5.9 |
| Build | Vite + `@vitejs/plugin-react` | ^7.3.7 |
| Estilos | Tailwind CSS **v4** vía `@tailwindcss/vite` (sin `tailwind.config.js`; tokens en `globals.css` con `@theme inline`) | ^4.3.3 |
| Componentes | shadcn-style propio: Radix primitives (`react-slot`, `react-select`, `react-slider`, `react-switch`, `react-tooltip`) + `class-variance-authority` + `clsx` + `tailwind-merge` (`cn()`) | varias |
| Estado | `zustand` | ^5.0.16 |
| Router | `react-router-dom` con `createHashRouter` | ^7.18.5 |
| i18n | `i18next` + `react-i18next` (locales `en`, `es`, `pt-BR` + test de paridad de claves/placeholders/vacíos) | ^26 / ^17 |
| Iconos | `lucide-react` | ^1.65.0 |
| Fuente | `@fontsource-variable/inter` | ^5.3.0 |
| Listas grandes | `@tanstack/react-virtual` (image-batch) | ^3.14 |
| Tests | Vitest + Testing Library + jsdom | ^3.2 |
| Diálogos | `@tauri-apps/plugin-dialog` | ^2.8.4 |

Dependencias específicas por producto (NO comunes): `decimal.js`, `zod`, `exceljs`, `jspdf` (profit-analyzer).

### Backend Rust (workspace Cargo)

- `edition = "2021"`, `license = "LicenseRef-Proprietary"`, `resolver = "2"`.
- Release: `lto = true`, `codegen-units = 1`, `opt-level = 3`, `strip = true`.
- Dependencias compartidas: `serde`, `serde_json`, `thiserror`, `rusqlite` (**bundled**), `ts-rs` v10 (genera bindings TS en `src/lib/ipc/bindings/`), `tempfile`, `walkdir` (ptp).
- Plugins Tauri: `tauri-plugin-dialog`, `tauri-plugin-opener`.
- `windows-sys` para Job Objects (ptp).
- Prefijos de crates por producto: `ibs-*` (image batch), `psc-*` (profit calculator), `ptp-*` (pdf toolbox). Clip Resizer debería usar `cr-*`.

### Crates por proyecto

| Proyecto | Crates |
|---|---|
| image-batch | `ibs-core` (motor completo: engine, codec, resize, thumbnail, job, naming, output, verify, sprite, watermark), `ibs-store` (SQLite+migraciones) |
| profit-analyzer | `psc-store` (motor de cálculo en TS puro `src/engine`; Rust solo persiste) |
| pdf-toolbox | `ptp-model` (tipos ts-rs), `ptp-files` (intake+rutas seguras+temporales), `ptp-engine` (qpdf+PDFium), `ptp-worker` (sidecar JSON-lines), `ptp-store`, `ptp-license` (política Free/Pro declarativa) |

---

## 2. Arquitectura común

```
React (features/*) → stores (Zustand) → lib/ipc (wrappers tipados + bindings ts-rs)
        ▲ Channel<T> eventos agregados ~10 Hz         │ invoke
src-tauri (capa fina): commands/*, state, error {code,message}, path validation
        │
crates/*: motor puro + store SQLite + licencias   (testeables con cargo test, sin Tauri)
```

Reglas que se repiten en los tres:

1. **La lógica pesada nunca está en la UI ni en los comandos Tauri.** `src-tauri` es una capa fina: valida, traduce errores a `CommandError{code,message}`, orquesta. El motor vive en crates Rust puros (ibs, ptp) o en TS puro aislado (psc `src/engine`, con regla ESLint anti-imports de React/Tauri).
2. **Tipos compartidos Rust→TS con `ts-rs`.** Contrato IPC jamás escrito a mano en ambos lados (evita desincronización). Tipos solo-TS se declaran en `lib/ipc/index.ts`.
3. **`CommandError { code, message }`** como única forma de error IPC; helpers `errorMessage()`/`errorCode()` en el frontend.
4. **Persistencia SQLite en Rust** con migraciones *append-only* (`PRAGMA user_version`, `MIGRATIONS: &[&str]` — nunca editar una migración publicada, solo añadir). El frontend nunca habla SQL.
5. **Un "Job" de datos como modelo central.** En ibs: `Job { inputs, pipeline, output: OutputSpec }`; cada módulo UI es una vista que construye un Job. En ptp: `PagePlan` como único modelo — 10 herramientas = 1 operación. En psc: `UnitScenario` — 11 módulos = 1 modelo de costes. **Esta es la lección más importante para Clip Resizer.**
6. **Salida segura (patrón en los tres):** escribir a temporal → verificar → publicar con rename atómico; rutas de salida iguales a una entrada se rechazan siempre; política de conflicto `rename (file (2)) | skip | overwrite-output`.
7. **Seguridad de rutas:** el webview nunca envía rutas arbitrarias para leer/escribir. Los diálogos de archivo se abren en Rust (`app.dialog().blocking_pick_file()`), las rutas seleccionadas entran a una whitelist (`viewable` en ibs) que el comando de lectura (`load_image`) exige. Canonicalización anti-symlink.
8. **Eventos agregados ~10 Hz** (`forward_batched` en `commands/jobs.rs`): mpsc desde el motor → buffer con `FLUSH_INTERVAL = 100ms` → `tauri::ipc::Channel`. La UI nunca recibe un evento por archivo.
9. **Cancelación cooperativa** con `Arc<AtomicBool>` comprobado entre etapas; un solo job en vuelo (`running_job` slot en AppState).
10. **Temas:** `.dark`/`.light` en `documentElement` desde `settings.theme`; tokens `--<prefix>-*` (p. ej. `--ibs-bg`, `--ibs-accent`) definidos en `globals.css` y mapeados a Tailwind con `@theme inline`. Light + dark desde el día 1.
11. **Documentación viva:** `docs/ARCHITECTURE.md` (propuesta/aprobada), `docs/CHECKLIST.md`, `docs/adr/NNNN-*.md` (ADRs numerados).

---

## 3. Patrones de componentes y UX

- **Layout fijo:** `AppLayout` = Sidebar (w-60) + `<main>` scrollable + `StatusBar` (h-9) inferior. Sidebar desde `NAV_ITEMS`/`TOOL_MODULES` en `src/app/modules.ts` con `{ id, path, icon: LucideIcon, available: boolean }` — **los módulos se declaran `available: false` hasta estar implementados y testeados** (cumple la regla "sin botones que no funcionen").
- **`components/ui/`** propio (shadcn-style): `button` (variantes primary/secondary/ghost/danger, cva), `card`, `badge`, `select` (Radix), `slider`, `switch`, `segmented`, `input`, `empty-state`, `tooltip`.
- **StatusBar** = barra de progreso global: estado running, totales, completados, fallidos, velocidad, ETA, estado de licencia (trial/licensed/expired coloreado), botón "abrir carpeta de salida".
- **Notificaciones:** ToastHost + `lib/toast.ts` (solo en profit-analyzer; ibs usa el status bar + estados inline).
- **Settings store:** `load()` al arrancar en `App.tsx`; `update()` persiste primero en backend y solo entonces actualiza el estado ("the UI only shows what the backend accepted"); `App.tsx` aplica tema+locale tras cargar settings; bloquea la app hasta settings cargados (loader), muestra error de carga a pantalla completa.
- **Onboarding:** wizard en primer arranque (`settings.onboardingDone`).
- **i18n:** todas las cadenas en `locales/{en,es,pt-BR}.json`; test Vitest de paridad de claves + placeholders + no-vacíos. Obligatorio desde fase 1.
- **`format.ts`**: formatBytes, formatDuration, etc. compartido y testeado.
- **`lib/ipc/index.ts`**: objeto `ipc` con un método por comando Tauri, tipos reexportados desde `bindings/`, helpers de error.

---

## 4. Procesamiento en segundo plano (lo más relevante para Clip Resizer)

### Image Batch (threads)

- `ibs_core::run(&job, concurrency, &cancel, |FileResult| ...)` en thread propio (`ibs-job`), con pool rayon de concurrencia configurable desde settings.
- `FileResult { status: Pending|Done|Skipped|Failed|Cancelled, output, error, warnings }` por archivo; `JobEvent::Progress{results} | Finished{summary} | Aborted{message}`.
- `preview_job(job) -> Vec<PlannedOutput>`: calcula nombres/colisiones **antes** de procesar (preview honesta).
- `record_batch` → tabla `job_history` (módulo, files, ok, failed, bytes_in/out, output_dir, meta JSON) → alimenta el Dashboard.
- Errores por archivo aislados (`catch_unwind` + límites de decodificación): un archivo corrupto nunca tumba el lote.

### PDF Toolbox (procesos worker — modelo más cercano a FFmpeg)

- `ptp-worker.exe` sidecar (`externalBin` en tauri.conf), **JSON-lines sobre stdin/stdout**, un worker responde ops con `{id, ok|error{code,message}}`.
- `WorkerPool`: `min(cores,4)` workers de jobs + 1 dedicado a thumbnails; round-robin; respawn si muere; arranque *fail-soft* (app abre aunque falte el sidecar y los comandos devuelven error claro).
- Timeout por llamada (120 s) → kill + respawn.
- **`job_object.rs` (Windows): Job Object por proceso hijo** — límite de memoria commit (2 GiB) + `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: si la app muere, el kernel mata a todos los hijos. **No quedan procesos huérfanos.**
- `TempRoot` por job bajo la propia raíz de caché; al arrancar se barren directorios huérfanos **solo de esa raíz** (nunca borrado por patrón fuera de ella).
- Protocolo de thumbnails: `register_uri_scheme_protocol("ptpthumb", ...)` sirviendo archivos de la caché → `<img src="ptpthumb://...">`; CSP restringe `img-src` a `asset:` + `ptpthumb:` + `data:`/`blob:`.

### Distribución de binarios nativos (patrón clave para FFmpeg)

- `scripts/fetch-pdfium.ps1`: descarga binario de release con **versión fijada + SHA-256 verificado** en `vendor/pdfium/` (gitignored, nunca commiteado); idempotente.
- `tauri.conf.json`: `bundle.resources` para `pdfium.dll`, `bundle.externalBin` para `ptp-worker`; NSIS `installMode: currentUser`, WebView2 `downloadBootstrapper`.
- `deny.toml` (cargo-deny): allowlist de licencias (MIT/Apache/BSD/Zlib/ISC/MPL-2.0/CC0…); AGPL/GPL/LGPL rechazadas por omisión. `vendor/` para binarios de terceros.
- `THIRD_PARTY_NOTICES` generado (cargo-about + license-checker) mostrado en Settings → About.

### Licencias / ediciones

Dos modelos complementarios:

- **ibs `src-tauri/src/license.rs`**: trial de 3 días con marcadores anti-reset (HMAC + fingerprint de máquina + detección de rollback de reloj), Lemon Squeezy REST (validate/activate/deactivate, timeout 10 s), claves firmadas Ed25519 `IBS1.*` verificables offline, gracia offline 14 días, revalidación ≤ 1/día sin bloquear el arranque. Todo en Rust compilado — el webview no puede eludirlo.
- **ptp `crates/ptp-license`**: `Policy::standard()` = tabla declarativa Free/Pro por herramienta (`ToolLimits { max_files_per_job, max_pages_per_document, max_file_size_mb, export_watermark }`). Las herramientas describen el trabajo (`JobShape`) y preguntan `Policy::check` **en el backend antes de exportar** → `LimitViolation{kind,limit,actual}`. "Sin licencia = modo Free, nunca bloqueo."

---

## 5. Convenciones de nombres y estilo

- Archivos TSX en PascalCase (`Sidebar.tsx`, `ToolPage.tsx`); utilidades en camelCase (`format.ts`, `job.ts`); stores `stores/<dominio>.ts` con `use<Domain>Store`.
- Features: `src/features/<modulo>/<ModuloPage>.tsx`.
- Bindings ts-rs: `src/lib/ipc/bindings/<Tipo>.ts` (un archivo por tipo, generado).
- Errores Rust: `thiserror` por crate (`StoreError`, `CommandError`); `code` en snake_case o kebab (`"workerDied"→"worker_died"` via `static_code`).
- Comentarios escasos y solo donde aportan (decisiones, seguridad). Nada de comentarios decorativos.
- Strings de usuario: jamás hardcodeados en JSX — siempre `t("...")`.

---

## 6. Qué patrones conviene REUTILIZAR en Clip Resizer

1. **Stack completo idéntico** (Tauri 2 + React 19 + TS strict + Vite + Tailwind 4 + shadcn-style + zustand + router-hash + i18n triple + lucide + Inter). Cero dudas de compatibilidad.
2. **Layout Sidebar + StatusBar + `modules.ts` con flag `available`.**
3. **Design tokens** `--cr-*` + `@theme inline` + `.dark`/`.light` (copiar estructura de `globals.css`, retocar paleta si se decide identidad propia).
4. **`lib/ipc` + ts-rs + `CommandError{code,message}`** tal cual.
5. **Modelo Job único** → `RenderSpec`/`Job` (ver CLIP_RESIZER_ARCHITECTURE.md).
6. **`forward_batched` ~10 Hz + `Channel<T>`** para progreso real de FFmpeg.
7. **Worker pool + JSON-lines + Job Object de Windows + timeout + kill/respawn** de `ptp` → directamente aplicable a `ffmpeg.exe` como proceso hijo (aún más simple: FFmpeg ya es un proceso).
8. **Salida segura**: temp → verificar (ffprobe) → rename atómico; rechazar output==input; conflicto rename/skip/overwrite.
9. **`fetch-<bin>.ps1` con versión+SHA-256 fijados en `vendor/`** → `fetch-ffmpeg.ps1`/`fetch-ffprobe`.
10. **`Policy` declarativa Free/Pro** de ptp-license (JobShape → LimitViolation) + sistema de activación de ibs (Lemon Squeezy + claves firmadas + trial/gracia).
11. **`deny.toml`** (allowlist de licencias) + THIRD_PARTY_NOTICES + About.
12. **Migraciones append-only rusqlite** + `job_history` → export history.
13. **i18n triple con test de paridad**, ADRs, CHECKLIST, `settings` persist-before-commit.
14. **Whitelist de rutas** (`viewable`) para servir archivos al webview.
15. **`CropEditor.tsx` de ibs como referencia** de editor visual de recorte con pointer-events (aunque sobre `<video>` en vez de imagen).

## 7. Qué NO conviene reutilizar / hacer diferente

1. **Procesamiento in-process con threads (modelo ibs)** → para vídeo NO: FFmpeg ya es un proceso externo y los vídeos son demasiado grandes para decodificar en memoria. Se adopta el modelo ptp (procesos).
2. **Un worker por llamada con stdin/stdout JSON-lines propio** → FFmpeg habla `-progress pipe:` + stderr, no JSON-lines; se implementa un wrapper `cr-ffmpeg` que parsea el protocolo real de FFmpeg (no inventar protocolo).
3. **`decimal.js`/engine en TS** → específico de dinero, no aplica.
4. **`@tanstack/react-virtual`** solo si la cola/historial crece (a favor si hay listas grandes; no añadir por defecto).
5. **react-hook-form + zod**: mencionado en doc de ibs pero no presente en el package.json real → no añadir hasta necesitar formularios complejos.
6. **ToastHost** existe solo en psc; para Clip Resizer el StatusBar + estados por ítem probablemente baste (decidir en fase de diseño de UI).
7. **Preview por imagen estática (`load_image` bytes)** → insuficiente: se necesita preview de vídeo (`<video>` + protocolo/proxy; ver riesgos).

---

## 8. Estado de madurez de cada referencia

| Área | ibs | psc | ptp |
|---|---|---|---|
| Layout/tema/i18n/settings | ✅ prod | ✅ prod | ✅ |
| Cola + progreso + cancelación | ✅ threads | n/a | ✅ procesos |
| Licencias (activación real) | ✅ LS + signed | planeado | política lista, activación fase 5 |
| Historial en SQLite | ✅ | ✅ | parcial |
| Binario externo fijado (vendor+sha256) | n/a | n/a | ✅ pdfium |
| Distribución instalador | NSIS/MSI | NSIS/MSI | NSIS/MSI/deb/appimage |

**Conclusión:** Clip Resizer es una combinación directa: la cola/lotes de **ibs** + la contención de procesos y distribución de binarios de **ptp** + el pulido de UI de **psc**. Ninguna pieza de infraestructura necesita inventarse.
