import { create } from "zustand";
import { ipc, type QueueItem } from "@/lib/ipc";

interface QueueStore {
  items: QueueItem[];
  loaded: boolean;
  load: () => Promise<void>;
  /** Wire a queue event into items (Snapshot or per-Item update). */
  apply: (e: { kind: string; items?: QueueItem[]; item?: QueueItem }) => void;
  cancel: (id: number) => Promise<void>;
  retry: (id: number) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export const useQueueStore = create<QueueStore>((set, get) => ({
  items: [],
  loaded: false,

  load: async () => {
    try {
      const items = await ipc.queueItems();
      set({ items, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  apply: (e) => {
    if (e.kind === "snapshot" && e.items) {
      set({ items: e.items });
    } else if (e.kind === "item" && e.item) {
      const it = e.item;
      set({ items: get().items.map((x) => (x.id === it.id ? it : x)) });
    }
  },

  cancel: async (id) => {
    try { await ipc.queueCancel(id); } catch { /* item not cancellable */ }
  },
  retry: async (id) => {
    try { await ipc.queueRetry(id); } catch { /* item not retryable */ }
  },
  remove: async (id) => {
    try { await ipc.queueRemove(id); } catch { /* item still running or gone */ }
  },
}));
