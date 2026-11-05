import { create } from "zustand";
import {
  errorMessage,
  ipc,
  type AspectPreset,
  type Background,
  type Canvas,
  type ConflictPolicy,
  type ExportSpec,
  type FitSpec,
  type RenderSpec,
  type VideoCodec,
  type VideoMeta,
} from "@/lib/ipc";

export interface StudioSpec {
  preset: AspectPreset;
  custom: Canvas;
  fit: FitSpec;
  background: Background;
  export: ExportSpec;
}

export const ASPECT_CANVAS: Record<Exclude<AspectPreset, "custom">, Canvas> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "16:9": { width: 1920, height: 1080 },
  "4:3": { width: 1440, height: 1080 },
  "3:4": { width: 1080, height: 1440 },
};

export const DEFAULT_SPEC: StudioSpec = {
  preset: "9:16",
  custom: { width: 1080, height: 1920 },
  fit: { kind: "fit" },
  background: { kind: "blur", sigma: 20, dim: 0.35 },
  export: { codec: "h264", quality: "balanced", fps: null, audio: "copy" },
};

export function specCanvas(s: StudioSpec): Canvas {
  return s.preset === "custom" ? s.custom : ASPECT_CANVAS[s.preset];
}

export function buildRenderSpec(input: string, s: StudioSpec): RenderSpec {
  return {
    input,
    canvas: specCanvas(s),
    fit: s.fit,
    background: s.background,
    export: s.export,
  };
}

export interface RenderState {
  running: boolean;
  pct: number;
  speed: number;
  donePath: string | null;
  doneBytes: number;
  error: string | null;
  cancelled: boolean;
  skipped: boolean;
}

const idleRender: RenderState = {
  running: false,
  pct: 0,
  speed: 0,
  donePath: null,
  doneBytes: 0,
  error: null,
  cancelled: false,
  skipped: false,
};

export type ItemStatus = "probing" | "ready" | "error";

export interface StudioItem {
  path: string;
  name: string;
  size: number;
  status: ItemStatus;
  meta: VideoMeta | null;
  /** clipthumb:// URL once rendered; null while pending/failed. */
  thumbUrl: string | null;
  error: string | null;
}

export interface ScanNotice {
  added: number;
  duplicates: number;
  rejected: number;
  truncated: boolean;
}

interface StudioState {
  items: StudioItem[];
  selected: string | null;
  scanning: boolean;
  scanNotice: ScanNotice | null;
  error: string | null;
  /** In-flight thumbnail requests, deduped by path. */
  thumbRequests: Record<string, boolean>;
  addPaths: (paths: string[]) => Promise<void>;
  removeItem: (path: string) => void;
  clear: () => void;
  select: (path: string | null) => void;
  /** Lazily renders a thumbnail for one item (called by visible rows). */
  ensureThumb: (path: string) => Promise<void>;
  spec: StudioSpec;
  setSpec: (patch: Partial<StudioSpec>) => void;
  render: RenderState;
  encoderName: string | null;
  previewFrameUrl: string | null;
  startRender: (conflict?: ConflictPolicy) => Promise<void>;
  cancelRender: () => Promise<void>;
  verifyFrame: (tS: number) => Promise<void>;
}

export const useStudioStore = create<StudioState>((set, get) => ({
  items: [],
  selected: null,
  scanning: false,
  scanNotice: null,
  error: null,
  thumbRequests: {},

  addPaths: async (paths) => {
    if (paths.length === 0) return;
    set({ scanning: true, error: null });
    try {
      const scan = await ipc.scanInputs(paths);
      const known = new Set(get().items.map((i) => i.path));
      const fresh: StudioItem[] = [];
      for (const f of scan.files) {
        if (known.has(f.path)) continue;
        known.add(f.path);
        fresh.push({
          path: f.path,
          name: f.name,
          size: f.size,
          status: "probing",
          meta: null,
          thumbUrl: null,
          error: null,
        });
      }
      set({
        items: [...get().items, ...fresh],
        scanning: false,
        scanNotice: {
          added: fresh.length,
          duplicates: scan.files.length - fresh.length,
          rejected: scan.rejected.length,
          truncated: scan.truncated,
        },
      });
      if (fresh.length === 0) return;
      // Probe in one batched call; each item updates independently.
      try {
        const results = await ipc.probeVideos(fresh.map((f) => f.path));
        const byPath = new Map(results.map((r) => [r.path, r]));
        set({
          items: get().items.map((i) => {
            const r = byPath.get(i.path);
            if (!r) return i;
            return r.meta
              ? { ...i, status: "ready", meta: r.meta }
              : { ...i, status: "error", error: r.error?.message ?? "probe failed" };
          }),
        });
      } catch (e) {
        // Whole-batch probe failure (e.g. missing ffmpeg): mark only the
        // items that were still probing, keep the rest.
        set({
          items: get().items.map((i) =>
            i.status === "probing" ? { ...i, status: "error", error: errorMessage(e) } : i,
          ),
        });
      }
    } catch (e) {
      set({ scanning: false, error: errorMessage(e) });
    }
  },

  removeItem: (path) => {
    set({
      items: get().items.filter((i) => i.path !== path),
      selected: get().selected === path ? null : get().selected,
    });
  },

  clear: () => set({ items: [], selected: null, scanNotice: null, error: null }),

  select: (path) => set({ selected: path }),

  ensureThumb: async (path) => {
    const state = get();
    if (state.thumbRequests[path]) return;
    const item = state.items.find((i) => i.path === path);
    if (!item || item.thumbUrl || item.status !== "ready") return;
    set({ thumbRequests: { ...state.thumbRequests, [path]: true } });
    try {
      // Seek 10% in (or 1s for short/unknown clips) — keyframe seek is cheap.
      const seek =
        item.meta && item.meta.durationMs > 0
          ? Math.min(item.meta.durationMs / 10000, 10)
          : 1.0;
      const t = await ipc.videoThumbnail(path, seek, 320);
      set({
        items: get().items.map((i) => (i.path === path ? { ...i, thumbUrl: t.url } : i)),
      });
    } catch {
      // A video with no decodable frame keeps the film-icon fallback —
      // probe already recorded the real error state.
    } finally {
      const req = { ...get().thumbRequests };
      delete req[path];
      set({ thumbRequests: req });
    }
  },

  spec: DEFAULT_SPEC,
  setSpec: (patch) => {
    set({ spec: { ...get().spec, ...patch }, previewFrameUrl: null });
    // Keep the honest encoder name in sync with the codec choice.
    const codec: VideoCodec = (patch.export?.codec ?? get().spec.export.codec) as VideoCodec;
    void ipc
      .resolveEncoder(codec)
      .then((e) => set({ encoderName: e }))
      .catch(() => set({ encoderName: null }));
  },
  render: idleRender,
  encoderName: null,
  previewFrameUrl: null,

  startRender: async (conflict = "rename") => {
    const s = get();
    const item = s.items.find((i) => i.path === s.selected && i.status === "ready");
    if (!item || s.render.running) return;
    const dir =
      (await ipc.getSettings()).defaultOutputDir ?? (await ipc.pickOutputDir()) ?? undefined;
    if (!dir) return;
    set({ render: { ...idleRender, running: true } });
    try {
      await ipc.startRender(buildRenderSpec(item.path, s.spec), dir, conflict, (e) => {
        if (e.kind === "progress") {
          set({ render: { ...get().render, pct: e.pct, speed: e.speed } });
        } else if (e.kind === "done") {
          set({ render: { ...idleRender, donePath: e.path, doneBytes: e.bytes } });
        } else if (e.kind === "failed") {
          set({ render: { ...idleRender, error: e.message } });
        } else if (e.kind === "cancelled") {
          set({ render: { ...idleRender, cancelled: true } });
        } else if (e.kind === "skipped") {
          set({ render: { ...idleRender, skipped: true } });
        }
      });
    } catch (err) {
      set({ render: { ...idleRender, error: errorMessage(err) } });
    }
  },

  cancelRender: async () => {
    try {
      await ipc.cancelRender();
    } catch {
      /* no render running */
    }
  },

  verifyFrame: async (tS) => {
    const s = get();
    const item = s.items.find((i) => i.path === s.selected && i.status === "ready");
    if (!item) return;
    try {
      const t = await ipc.previewFrame(buildRenderSpec(item.path, s.spec), tS);
      set({ previewFrameUrl: `${t.url}?v=${Date.now()}` });
    } catch (e) {
      set({ render: { ...get().render, error: errorMessage(e) } });
    }
  },
}));
