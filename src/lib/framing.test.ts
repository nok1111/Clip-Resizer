import { describe, expect, it } from "vitest";
import type { FitSpec } from "@/lib/ipc";
import { constrain, effectivePan, foldLegacy, frameCtx, freshFit, placement, snap, zoomAt } from "./framing";

const ctx = (rotate = 0, margin = 0, border = 0) =>
  frameCtx({ width: 1080, height: 1920 }, { width: 1920, height: 1080 }, rotate, margin, border);
const fit = (kind: FitSpec["kind"], zoom: number, pan_x = 0, pan_y = 0): FitSpec => ({
  ...freshFit(kind),
  zoom,
  pan_x,
  pan_y,
});
const centre = (p: { x: number; y: number; w: number; h: number }) => [p.x + p.w / 2, p.y + p.h / 2];

describe("framing", () => {
  it("matches the Rust letterbox placement", () => {
    const p = placement(fit("fit", 1), ctx());
    expect(p.x).toBeCloseTo(0);
    expect(p.w).toBeCloseTo(1080);
    expect(p.y).toBeCloseTo((1920 - 607.5) / 2);
  });

  it("lets a zoomed-out fg leave the canvas (Rust zoomed_out_fg_can_leave_the_canvas)", () => {
    const p = placement(fit("fit", 0.5, 0.5), ctx());
    expect(p.x).toBeCloseTo(1080 - 270);
  });

  it("pan is zoom independent (Rust pan_is_zoom_independent)", () => {
    for (const z of [0.3, 0.316, 0.5, 1, 2, 8]) {
      const [cx, cy] = centre(placement(fit("fill", z, 0.2, -0.1), ctx()));
      expect(cx).toBeCloseTo(540 + 216);
      expect(cy).toBeCloseTo(960 - 192);
    }
  });

  it("legacy offsets render like before (Rust legacy_offsets_still_render_like_before)", () => {
    const legacy: FitSpec = { kind: "fill", zoom: 1.5, offset_x: 2, offset_y: -5, pan_x: 0, pan_y: 0 };
    const p = placement(legacy, ctx());
    expect(p.x + p.w).toBeCloseTo(1080);
    expect(p.y).toBeCloseTo(0);
    const folded = foldLegacy(legacy, ctx());
    expect(folded.offset_x).toBe(0);
    expect(placement(folded, ctx())).toEqual(p);
  });

  it("old presets without pan fields still work", () => {
    const old = { kind: "fit", zoom: 1, offset_x: 0.5, offset_y: 0 } as unknown as FitSpec;
    expect(Number.isFinite(effectivePan(old, ctx()).x)).toBe(true);
    expect(foldLegacy(old, ctx()).pan_y).toBe(0);
  });

  it("zooming keeps the anchored source point fixed, even across slack zero", () => {
    // 16:9 in 9:16 passes "fg width == canvas width" around zoom 0.316 —
    // the old slack-relative math jumped there.
    let f = fit("fill", 1.2, 0.05, 0);
    f = constrain(f, ctx());
    const anchor = { x: 300, y: 900 };
    const srcUnder = (g: FitSpec) => {
      const p = placement(g, ctx());
      return [(anchor.x - p.x) / p.scale, (anchor.y - p.y) / p.scale];
    };
    const before = srcUnder(f);
    for (const z of [0.9, 0.5, 0.316, 0.31, 0.2]) {
      const g = zoomAt(f, ctx(), z, anchor);
      const [sx, sy] = srcUnder(g);
      expect(sx).toBeCloseTo(before[0]!, 4);
      expect(sy).toBeCloseTo(before[1]!, 4);
    }
    // ...and zooming back restores the framing exactly.
    const back = zoomAt(zoomAt(f, ctx(), 0.3), ctx(), 1.2);
    expect(back.pan_x).toBeCloseTo(f.pan_x);
  });

  it("fill at zoom ≥ 1 keeps covering the canvas", () => {
    const f = constrain(fit("fill", 1, 0.9, 0.3), ctx());
    const p = placement(f, ctx());
    expect(p.x).toBeLessThanOrEqual(1e-9);
    expect(p.x + p.w).toBeGreaterThanOrEqual(1080 - 1e-9);
    expect(f.pan_y).toBe(0);
  });

  it("uses rotated dimensions", () => {
    const p = placement(fit("fit", 1), ctx(90));
    expect(p.w).toBeCloseTo(1080);
    expect(p.h).toBeCloseTo(1920);
  });

  it("snaps the centre and edges", () => {
    const s = snap(fit("fit", 0.5, 0.004, 0.25), ctx(), 10);
    expect(s.x).toBe(540);
    expect(centre(placement(s.fit, ctx()))[0]).toBeCloseTo(540);
    expect(s.y).toBeNull();
    const e = snap(fit("fit", 0.4, 0.295), ctx(), 10);
    expect(e.x).toBe(1080);
  });
});
