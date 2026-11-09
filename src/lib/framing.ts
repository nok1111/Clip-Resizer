import type { Canvas, FitSpec } from "@/lib/ipc";

/**
 * Framing math shared by the preview, the store and (mirrored in Rust as
 * `cr_ffmpeg::render::placement`) the export. Coordinates are canvas
 * pixels; the source size is post-rotation.
 *
 * Position model: `pan_x/pan_y` move the fg centre by a fraction of the
 * canvas, independent of zoom → zooming and dragging never divide by the
 * (possibly zero) crop slack. `offset_x/offset_y` are legacy slack-relative
 * offsets kept for old presets; `foldLegacy` turns them into pan.
 */
export interface FrameCtx {
  canvas: Canvas;
  srcW: number;
  srcH: number;
  margin: number;
  border: number;
}

export interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
  border: number;
}

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 8;
const PAN_LIMIT = 4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fin = (v: number | undefined) => (v !== undefined && Number.isFinite(v) ? v : 0);

export function freshFit(kind: FitSpec["kind"]): FitSpec {
  return { kind, zoom: 1, offset_x: 0, offset_y: 0, pan_x: 0, pan_y: 0 };
}

export function frameCtx(
  canvas: Canvas,
  meta: { width: number; height: number },
  rotate: number,
  margin: number,
  border: number,
): FrameCtx {
  const rot = ((rotate % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  return {
    canvas,
    srcW: Math.max(1, swap ? meta.height : meta.width),
    srcH: Math.max(1, swap ? meta.width : meta.height),
    margin,
    border,
  };
}

/** Output px per source px for `fit`. */
export function fitScale(fit: FitSpec, c: FrameCtx): number {
  const { width: cw, height: ch } = c.canvas;
  const z = clamp(fin(fit.zoom) || 1, 0.05, ZOOM_MAX);
  if (fit.kind === "fill") return Math.max(cw / c.srcW, ch / c.srcH) * z;
  const m = clamp(c.margin, 0, 0.4);
  return Math.min(cw / c.srcW, ch / c.srcH) * (1 - 2 * m) * z;
}

function framed(fit: FitSpec): boolean {
  return fit.kind === "fit" || clamp(fin(fit.zoom) || 1, 0.05, ZOOM_MAX) < 0.999;
}

/** Pan including the contribution of legacy offsets. */
export function effectivePan(fit: FitSpec, c: FrameCtx): { x: number; y: number } {
  const s = fitScale(fit, c);
  const b = framed(fit) ? Math.max(0, c.border) : 0;
  const { width: cw, height: ch } = c.canvas;
  const ow = c.srcW * s + 2 * b;
  const oh = c.srcH * s + 2 * b;
  return {
    x: clamp(fin(fit.pan_x), -PAN_LIMIT, PAN_LIMIT) - (clamp(fin(fit.offset_x), -1, 1) * (ow - cw)) / (2 * cw),
    y: clamp(fin(fit.pan_y), -PAN_LIMIT, PAN_LIMIT) - (clamp(fin(fit.offset_y), -1, 1) * (oh - ch)) / (2 * ch),
  };
}

/** Where the fg content lands on the canvas. Mirrors Rust `placement`. */
export function placement(fit: FitSpec, c: FrameCtx): Placement {
  const { width: cw, height: ch } = c.canvas;
  const scale = fitScale(fit, c);
  const w = c.srcW * scale;
  const h = c.srcH * scale;
  const border = framed(fit) ? Math.max(0, c.border) : 0;
  const p = effectivePan(fit, c);
  const cx = clamp(cw / 2 + p.x * cw, 4 - w / 2, cw - 4 + w / 2);
  const cy = clamp(ch / 2 + p.y * ch, 4 - h / 2, ch - 4 + h / 2);
  return { x: cx - w / 2, y: cy - h / 2, w, h, scale, border };
}

export function foldLegacy(fit: FitSpec, c: FrameCtx): FitSpec {
  if (!fin(fit.offset_x) && !fin(fit.offset_y) && fit.pan_x !== undefined && fit.pan_y !== undefined) {
    return fit;
  }
  const p = effectivePan(fit, c);
  return { ...fit, offset_x: 0, offset_y: 0, pan_x: p.x, pan_y: p.y };
}

/**
 * Keeps pan in range; in Fill with zoom ≥ 1 the fg must keep covering the
 * canvas (no letterbox appears while panning a crop).
 */
export function constrain(fit: FitSpec, c: FrameCtx): FitSpec {
  const f = foldLegacy(fit, c);
  let px = clamp(fin(f.pan_x), -PAN_LIMIT, PAN_LIMIT);
  let py = clamp(fin(f.pan_y), -PAN_LIMIT, PAN_LIMIT);
  if (f.kind === "fill" && !framed(f)) {
    const s = fitScale(f, c);
    const { width: cw, height: ch } = c.canvas;
    const mx = Math.max(0, (c.srcW * s - cw) / (2 * cw));
    const my = Math.max(0, (c.srcH * s - ch) / (2 * ch));
    px = clamp(px, -mx, mx);
    py = clamp(py, -my, my);
  }
  if (px === f.pan_x && py === f.pan_y) return f;
  return { ...f, pan_x: px, pan_y: py };
}

/**
 * Zoom keeping the source point under `anchor` (canvas px, default the
 * canvas centre) fixed on screen.
 */
export function zoomAt(fit: FitSpec, c: FrameCtx, zoom: number, anchor?: { x: number; y: number }): FitSpec {
  const f = foldLegacy(fit, c);
  const { width: cw, height: ch } = c.canvas;
  const a = anchor ?? { x: cw / 2, y: ch / 2 };
  const z = clamp(zoom, ZOOM_MIN, ZOOM_MAX);
  const s1 = fitScale(f, c);
  const next = { ...f, zoom: z };
  const k = fitScale(next, c) / s1;
  const cx = cw / 2 + fin(f.pan_x) * cw;
  const cy = ch / 2 + fin(f.pan_y) * ch;
  return constrain(
    { ...next, pan_x: (a.x + (cx - a.x) * k - cw / 2) / cw, pan_y: (a.y + (cy - a.y) * k - ch / 2) / ch },
    c,
  );
}

export interface Snap {
  fit: FitSpec;
  /** Canvas px of the guide lines hit (for drawing), or null. */
  x: number | null;
  y: number | null;
}

/** Magnet the fg centre/edges to the canvas centre/edges within `tol` px. */
export function snap(fit: FitSpec, c: FrameCtx, tol: number): Snap {
  const p = placement(fit, c);
  const { width: cw, height: ch } = c.canvas;
  const axis = (start: number, size: number, canvas: number) => {
    let best: { d: number; line: number } | null = null;
    for (const [edge, line] of [
      [start + size / 2, canvas / 2],
      [start, 0],
      [start + size, canvas],
      [start, canvas / 2],
      [start + size, canvas / 2],
    ] as const) {
      const d = line - edge;
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line };
    }
    return best;
  };
  const sx = axis(p.x, p.w, cw);
  const sy = axis(p.y, p.h, ch);
  const f = foldLegacy(fit, c);
  return {
    fit: {
      ...f,
      pan_x: fin(f.pan_x) + (sx ? sx.d / cw : 0),
      pan_y: fin(f.pan_y) + (sy ? sy.d / ch : 0),
    },
    x: sx ? sx.line : null,
    y: sy ? sy.line : null,
  };
}
