import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
  convertFileSrc: (p: string) => p,
  Channel: class {},
}));

import type { VideoMeta } from "@/lib/ipc";
import { DEFAULT_SPEC, fitFor, useStudioStore, type StudioItem } from "./studio";

const meta = { width: 1280, height: 720, durationMs: 3000, rotationDeg: 0 } as unknown as VideoMeta;
const item = (path: string): StudioItem => ({
  path, name: path, size: 1, status: "ready", meta, thumbUrl: null, error: null,
});

describe("per-video framing", () => {
  beforeEach(() => {
    useStudioStore.setState({
      items: [item("a"), item("b")],
      selected: null,
      spec: DEFAULT_SPEC,
      sharedFit: DEFAULT_SPEC.fit,
      fitByPath: {},
    });
    useStudioStore.getState().select("a");
  });

  it("edits the shared framing by default", () => {
    useStudioStore.getState().zoomTo(2);
    const s = useStudioStore.getState();
    expect(s.sharedFit.zoom).toBeCloseTo(2);
    expect(fitFor(s, "b").zoom).toBeCloseTo(2);
    s.select("b");
    expect(useStudioStore.getState().spec.fit.zoom).toBeCloseTo(2);
  });

  it("'this video' keeps edits off the other videos and survives reselection", () => {
    const st = useStudioStore.getState();
    st.setFitScope("one");
    st.zoomTo(3);
    let s = useStudioStore.getState();
    expect(fitFor(s, "a").zoom).toBeCloseTo(3);
    expect(fitFor(s, "b").zoom).toBeCloseTo(1);
    s.select("b");
    expect(useStudioStore.getState().spec.fit.zoom).toBeCloseTo(1);
    useStudioStore.getState().select("a");
    s = useStudioStore.getState();
    expect(s.spec.fit.zoom).toBeCloseTo(3);
  });

  it("back to 'all' restores the shared framing; apply-to-all promotes the override", () => {
    const st = useStudioStore.getState();
    st.setFitScope("one");
    st.zoomTo(3);
    useStudioStore.getState().setFitScope("all");
    expect(useStudioStore.getState().spec.fit.zoom).toBeCloseTo(1);

    useStudioStore.getState().setFitScope("one");
    useStudioStore.getState().zoomTo(2.5);
    useStudioStore.getState().applyFitToAll();
    const s = useStudioStore.getState();
    expect(s.fitByPath).toEqual({});
    expect(fitFor(s, "b").zoom).toBeCloseTo(2.5);
  });

  it("removing a video drops its override", () => {
    useStudioStore.getState().setFitScope("one");
    useStudioStore.getState().removeItem("a");
    expect(useStudioStore.getState().fitByPath).toEqual({});
  });
});
