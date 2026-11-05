import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, FolderOpen, Loader2, RotateCcw, Trash2, XCircle, ListVideo } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ipc, type QueueItem, type QueueStatus } from "@/lib/ipc";
import { useQueueStore } from "@/stores/queue";
import { useStudioStore } from "@/stores/studio";

const STATUS_KIND: Record<QueueStatus, "accent" | "success" | "danger" | "warning" | "muted"> = {
  pending: "muted",
  processing: "accent",
  done: "success",
  failed: "danger",
  cancelled: "warning",
  skipped: "warning",
};

export function QueuePage() {
  const { t } = useTranslation();
  const { items, load, cancel, retry, remove } = useQueueStore();
  const items2 = useStudioStore((s) => s.items);
  const ready = items2.filter((i) => i.status === "ready").length;
  const enqueueAll = useStudioStore((s) => s.enqueueAll);

  useEffect(() => {
    void load();
  }, [load]);

  const running = items.some((i) => i.status === "processing");
  const pending = items.filter((i) => i.status === "pending").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t("nav.queue")}
        actions={
          <Button disabled={ready === 0} onClick={() => void enqueueAll()}>
            <ListVideo />
            {t("queue.enqueueAll", { count: ready })}
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {items.length === 0 ? (
          <EmptyState
            icon={ListVideo}
            title={t("queue.empty")}
            body={ready > 0 ? t("queue.emptyHint", { count: ready }) : t("queue.emptyNoVideos")}
          />
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((i) => (
              <QueueRow key={i.id} item={i} onCancel={cancel} onRetry={retry} onRemove={remove} />
            ))}
          </div>
        )}
        {(running || pending > 0) && (
          <p className="mt-3 text-xs text-text-secondary">
            {t("queue.running", { pending })}
          </p>
        )}
      </div>
    </div>
  );
}

function QueueRow({
  item,
  onCancel,
  onRetry,
  onRemove,
}: {
  item: QueueItem;
  onCancel: (id: number) => Promise<void>;
  onRetry: (id: number) => Promise<void>;
  onRemove: (id: number) => Promise<void>;
}) {
  const { t } = useTranslation();
  const active = item.status === "processing";
  const terminal = item.status === "failed" || item.status === "cancelled" || item.status === "skipped";
  return (
    <Card className="p-0">
      <CardContent className="flex items-center gap-4 px-4 py-3">
        {active ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-accent" />
        ) : item.status === "done" ? (
          <CheckCircle2 className="size-4 shrink-0 text-success" />
        ) : item.status === "failed" ? (
          <XCircle className="size-4 shrink-0 text-danger" />
        ) : (
          <div className="size-4 shrink-0 rounded-full border border-border" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text">{item.name}</p>
          {active ? (
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-bg-secondary">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${item.pct}%` }} />
            </div>
          ) : (
            <p className="truncate text-xs text-text-secondary">
              {item.error ?? item.outPath ?? ""}
            </p>
          )}
        </div>
        {active && <span className="text-xs tabular-nums text-text-secondary">{item.pct.toFixed(0)}%</span>}
        <Badge variant={STATUS_KIND[item.status]}>{t(`queue.status.${item.status}`)}</Badge>
        {item.outPath && (
          <Button variant="ghost" size="icon" title={t("studio.reveal")}
            onClick={() => void ipc.revealPath(item.outPath!).catch(() => undefined)}>
            <FolderOpen />
          </Button>
        )}
        {active ? (
          <Button variant="danger" size="sm" onClick={() => void onCancel(item.id)}>{t("render.cancel")}</Button>
        ) : terminal ? (
          <>
            <Button variant="secondary" size="icon" title={t("queue.retry")} onClick={() => void onRetry(item.id)}>
              <RotateCcw />
            </Button>
            <Button variant="ghost" size="icon" title={t("queue.remove")} onClick={() => void onRemove(item.id)}>
              <Trash2 />
            </Button>
          </>
        ) : item.status === "pending" ? (
          <Button variant="ghost" size="icon" title={t("queue.remove")} onClick={() => void onRemove(item.id)}>
            <Trash2 />
          </Button>
        ) : (
          <Button variant="ghost" size="icon" title={t("queue.remove")} onClick={() => void onRemove(item.id)}>
            <Trash2 />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
