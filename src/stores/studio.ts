import { create } from "zustand";
import { errorMessage, ipc, type VideoMeta } from "@/lib/ipc";

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
}));
