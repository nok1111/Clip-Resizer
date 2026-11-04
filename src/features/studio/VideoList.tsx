import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, Clapperboard, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { aspectLabel, formatBytes, formatDurationMs } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useStudioStore, type StudioItem } from "@/stores/studio";

const ROW_HEIGHT = 64;

const STATUS_VARIANT = {
  probing: "warning",
  ready: "success",
  error: "danger",
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
  return (
    <button
      type="button"
      role="listitem"
      onClick={onSelect}
      className={cn(
        "absolute left-0 top-0 flex w-full items-center gap-3 border-b border-border/60 px-3 text-left transition-colors",
        selected ? "bg-card-hover" : "hover:bg-card-hover/60",
      )}
      style={{ height: ROW_HEIGHT, transform: `translateY(${top}px)` }}
    >
      <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-bg-secondary">
        {item.thumbUrl ? (
          <img src={item.thumbUrl} alt="" className="size-full object-cover" draggable={false} />
        ) : item.status === "error" ? (
          <AlertTriangle className="size-5 text-danger/70" />
        ) : (
          <Clapperboard className="size-5 text-text-secondary/50" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-text" title={item.path}>
          {item.name}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-secondary">
          <span className="tabular-nums">{formatBytes(item.size)}</span>
          {m && (
            <>
              <span className="tabular-nums">{formatDurationMs(m.durationMs)}</span>
              <span className="tabular-nums">
                {m.width}×{m.height}
              </span>
              <span>{aspectLabel(m.width, m.height)}</span>
              <span className="uppercase">{m.codec}</span>
            </>
          )}
          {item.status === "error" && (
            <span className="truncate text-danger" title={item.error ?? undefined}>
              {item.error}
            </span>
          )}
        </span>
      </span>
      <Badge variant={STATUS_VARIANT[item.status]}>{t(`studio.status${item.status === "probing" ? "Probing" : item.status === "ready" ? "Ready" : "Error"}`)}</Badge>
      <span
        role="button"
        tabIndex={-1}
        aria-label={t("studio.remove")}
        title={t("studio.remove")}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="shrink-0 rounded p-1 text-text-secondary hover:bg-bg-secondary hover:text-text"
      >
        <X className="size-4" />
      </span>
    </button>
  );
}
