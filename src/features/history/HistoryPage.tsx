import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Clock3, FolderOpen, XCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { errorMessage, ipc, type HistoryRow } from "@/lib/ipc";
import { formatBytes } from "@/lib/format";

export function HistoryPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    ipc
      .renderHistory()
      .then((r) => setRows(r))
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={t("nav.history")} />
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
        {error && <p className="mb-3 text-xs text-danger">{error}</p>}
        {loaded && rows.length === 0 && !error ? (
          <EmptyState icon={Clock3} title={t("history.empty")} body={t("history.emptyHint")} />
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((r) => (
              <Row key={r.id} row={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ row }: { row: HistoryRow }) {
  const { t, i18n } = useTranslation();
  const name = row.output.split(/[\\/]/).pop() ?? row.output;
  const when = new Date(row.finishedAt).toLocaleString(i18n.language);
  const done = row.status === "done";
  return (
    <Card className="p-0">
      <CardContent className="flex items-center gap-4 px-4 py-3">
        {done ? (
          <CheckCircle2 className="size-4 shrink-0 text-success" />
        ) : (
          <XCircle className="size-4 shrink-0 text-danger" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text" title={row.output}>
            {name}
          </p>
          <p className="truncate text-xs text-text-secondary" title={row.input}>
            {row.input.split(/[\\/]/).pop()} · {when}
          </p>
        </div>
        <span className="text-xs tabular-nums text-text-secondary">
          {row.bytes > 0 ? formatBytes(row.bytes) : "—"}
        </span>
        <Badge variant={done ? "success" : "danger"}>
          {done ? t("queue.status.done") : t("queue.status.failed")}
        </Badge>
        {done && (
          <Button
            variant="ghost"
            size="icon"
            title={t("studio.reveal")}
            onClick={() => void ipc.revealPath(row.output).catch(() => undefined)}
          >
            <FolderOpen />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
