import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, Clapperboard, Crop, X } from "lucide-react";
import { aspectLabel, formatBytes, formatDurationMs, formatFps } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useStudioStore, type StudioItem } from "@/stores/studio";

const ROW_HEIGHT = 56;

const STATUS_DOT = {
  probing: "bg-warning animate-pulse",
  ready: "bg-success",
  error: "bg-danger",
} as const;

export function VideoList() {
  const { t } = useTranslation();
  const items = useStudioStore((s) => s.items);
  const selected = useStudioStore((s) => s.selected);
  const select = useStudioStore((s) => s.select);
  const removeItem = useStudioStore((s) => s.removeItem);
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  return (
    <div ref={parentRef} className="h-full overflow-auto" role="list" aria-label={t("studio.videos")}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((row) => {
          const item = items[row.index]!;
          return (
            <VideoRow
              key={item.path}
              item={item}
              top={row.start}
              selected={selected === item.path}
              onSelect={() => select(item.path)}
              onRemove={() => removeItem(item.path)}
            />
          );
        })}
      </div>
    </div>
  );
}

function VideoRow({
  item,
  top,
  selected,
  onSelect,
  onRemove,
}: {
  item: StudioItem;
  top: number;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const ensureThumb = useStudioStore((s) => s.ensureThumb);

  // Only rendered rows request a thumbnail (virtualization = lazy for free).
  useEffect(() => {
    void ensureThumb(item.path);
  }, [item.path, item.status, ensureThumb]);

  const m = item.meta;
  const own = useStudioStore((s) => s.fitByPath[item.path] != null);
  const details = m
    ? [
        item.path,
        `${m.width}×${m.height} (${aspectLabel(m.width, m.height)}) · ${formatFps(m.fps)} fps · ${m.codec.toUpperCase()}`,
        `${formatDurationMs(m.durationMs)} · ${formatBytes(item.size)}${m.bitrateKbps ? ` · ${m.bitrateKbps.toLocaleString()} kbps` : ""}`,
        `${t("studio.audio")}: ${m.hasAudio ? t("studio.audioYes") : t("studio.audioNo")}`,
      ].join("\n")
    : item.path;
  return (
    <div
      role="listitem"
      className={cn(
        "group absolute left-0 top-0 flex w-full items-center gap-2.5 border-b border-border/60 px-2.5 text-left transition-colors",
        selected ? "bg-card-hover shadow-[inset_3px_0_0_var(--cr-accent)]" : "hover:bg-card-hover/60",
      )}
      style={{ height: ROW_HEIGHT, transform: `translateY(${top}px)` }}
    >
      <button type="button" onClick={onSelect} title={details} className="flex min-w-0 flex-1 items-center gap-2.5 text-left cursor-pointer">
        <span className="flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-bg-secondary">
          {item.thumbUrl ? (
            <img src={item.thumbUrl} alt="" className="size-full object-cover" draggable={false} />
          ) : item.status === "error" ? (
            <AlertTriangle className="size-4 text-danger/70" />
          ) : (
            <Clapperboard className="size-4 text-text-secondary/50" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-text">{item.name}</span>
          <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-text-secondary">
            {m ? (
              <>
                <span className="tabular-nums">{formatDurationMs(m.durationMs)}</span>
                <span className="tabular-nums">{m.width}×{m.height}</span>
              </>
            ) : item.status === "error" ? (
              <span className="truncate text-danger">{item.error}</span>
            ) : (
              <span>{t("studio.statusProbing")}</span>
            )}
            {own && <Crop className="size-3 shrink-0 text-accent" aria-label={t("studio.ownFraming")} />}
          </span>
        </span>
      </button>
      <span
        className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[item.status])}
        title={t(`studio.status${item.status === "probing" ? "Probing" : item.status === "ready" ? "Ready" : "Error"}`)}
      />
      <button
        type="button"
        aria-label={t("studio.remove")}
        title={t("studio.remove")}
        onClick={onRemove}
        className="shrink-0 rounded p-1 text-text-secondary opacity-0 transition-opacity hover:bg-bg-secondary hover:text-text group-hover:opacity-100 focus:opacity-100 cursor-pointer"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
