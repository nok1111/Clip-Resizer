# Clip Resizer — Known Issues & Limitations

Registro de limitaciones conocidas. Cada entrada indica estado y mitigación. Nada aquí se simula ni se oculta en la UI.

## Limitaciones inherentes (documentadas, no bugs)

| # | Limitación | Estado / Mitigación |
|---|---|---|
| L1 | **FFmpeg no puede pausar un render.** El spec pide "pausar cuando sea técnicamente seguro" → se implementará Cancel + Retry; la pausa no existe sin perder el trabajo. | Documentado (§8 ARCH). UI solo mostrará Cancel/Retry. |
| L2 | **WebView2 no reproduce todos los códecs/contenedores** (MKV, HEVC según máquina, ProRes). | Proxy automático en caché para preview; el export usa el original. La UI indicará "preview aproximada". |
| L3 | **Preview CSS es aproximación del filtergraph real.** | Botón "verificar frame real" ejecuta FFmpeg sobre 1 frame. |
| L4 | **Entradas HDR/dolby pueden verse desaturadas** al convertir a SDR sin tone mapping. | MVP: documentar. Fase posterior: `zscale`+`tonemap`. |
| L5 | **Progreso de FFmpeg** es exacto en tiempo procesado pero el ETA depende de `speed`, que fluctúa. | Mostrar % real + velocidad, ETA como estimación etiquetada. |
| L6 | **Licencias FFmpeg (GPL build)**: distribuir `ffmpeg.exe` como proceso separado es "mere aggregation", pero las patentes H.264/H.265 son responsabilidad del distribuidor. | Preferir encoders HW del SO (`h264_mf`, nvenc, qsv, amf); notices + oferta de fuente; revisión legal antes del lanzamiento comercial. |
| L7 | **Windows SmartScreen** mostrará advertencia sin certificado de firma de código (compra pendiente, decisión comercial). | Igual que el resto de la familia; documentado en instalador. |
| L8 | **Estimación de tamaño de salida** es aproximada (bitrate objetivo × duración). | Mostrar como estimación; validar espacio en disco con margen. |

## Issues abiertos

*(ninguno todavía — se registrará aquí cualquier problema encontrado en desarrollo)*
