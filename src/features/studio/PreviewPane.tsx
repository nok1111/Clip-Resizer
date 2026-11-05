import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Clapperboard, FolderOpen, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { aspectLabel, formatBytes, formatDurationMs, formatFps } from "@/lib/format";
import { ipc } from "@/lib/ipc";
import { useStudioStore } from "@/stores/studio";
import { ComposedPreview } from "./ComposedPreview";
import { ExportPanel, FitPanel, FormatPanel } from "./panels";

export function PreviewPane() {
  const { t } = useTranslation();
  const item = useStudioStore((s) => s.items.find((i) => i.path === s.selected));
  const render = useStudioStore((s) => s.render);
  const startRender = useStudioStore((s) => s.startRender);
  const cancelRender = useStudioStore((s) => s.cancelRender);
  const [playErrorPath, setPlayErrorPath] = useState<string | null>(null);
  const playError = item != null && playErrorPath === item.path;

  return (
    <Card className="flex min-h-0 flex-col overflow-hidden p-0">
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/40">
        {!item && (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <Clapperboard className="size-10 text-text-secondary/40" />
            <p className="text-sm text-text-secondary">{t("studio.emptyPreview")}</p>
          </div>
        )}
        {item && item.status === "ready" && !playError && (
          <ComposedPreview item={item} onError={() => setPlayErrorPath(item.path)} />
        )}
        {item && (item.status !== "ready" || playError) && (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <AlertTriangle className="size-8 text-warning/70" />
            <p className="max-w-sm text-sm text-text-secondary">
              {item.status === "error"
                ? (item.error ?? t("studio.probeFailed"))
                : item.status === "probing"
                  ? t("studio.probing")
                  : t("studio.cannotPlay")}
            </p>
          </div>
        )}
        {render.running && (
          <div className="absolute inset-x-0 bottom-0 bg-black/60 px-4 py-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-bg-secondary">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${render.pct}%` }} />
            </div>
            <p className="mt-1 text-xs tabular-nums text-text">
              {render.pct.toFixed(0)}% · {render.speed.toFixed(1)}×
            </p>
          </div>
        )}
      </div>

      <div className="max-h-[46%] overflow-y-auto border-t border-border">
        {item && (
          <div className="grid gap-3 p-4 md:grid-cols-3">
            <FormatPanel />
            <FitPanel />
            <div className="flex flex-col gap-3">
              <ExportPanel />
              <div className="flex gap-2">
                {render.running ? (
                  <Button variant="danger" className="flex-1" onClick={() => void cancelRender()}>
                    <Square />
                    {t("render.cancel")}
                  </Button>
                ) : (
                  <Button
                    className="flex-1"
                    disabled={item.status !== "ready"}
                    onClick={() => void startRender()}
                  >
                    <Play />
                    {t("render.export")}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="icon"
                  title={t("studio.reveal")}
                  onClick={() => void ipc.revealPath(item.path).catch(() => undefined)}
                >
                  <FolderOpen />
                </Button>
              </div>
              {render.error && <p className="text-xs text-danger">{render.error}</p>}
              {render.cancelled && <p className="text-xs text-warning">{t("render.cancelled")}</p>}
              {render.skipped && <p className="text-xs text-warning">{t("render.skipped")}</p>}
              {render.donePath && (
                <p className="break-all text-xs text-success">
                  {t("render.done", { bytes: formatBytes(render.doneBytes) })}
                  <br />
                  <span className="text-text-secondary">{render.donePath}</span>
                </p>
              )}
            </div>
          </div>
        )}
        {item?.meta && <MetaStrip meta={item.meta} size={item.size} />}
      </div>
    </Card>
  );
}

function MetaStrip({ meta: m, size }: { meta: import("@/lib/ipc").VideoMeta; size: number }) {
  const { t } = useTranslation();
  return (
    <Card className="mx-4 mb-4 bg-bg-secondary">
      <CardHeader className="pb-2">
        <CardTitle>{t("studio.metadata")}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
          <Meta label={t("studio.duration")} value={formatDurationMs(m.durationMs)} />
          <Meta label={t("studio.resolution")} value={`${m.width}×${m.height} (${aspectLabel(m.width, m.height)})`} />
          <Meta label={t("studio.fps")} value={formatFps(m.fps)} />
          <Meta label={t("studio.codec")} value={m.codec} />
          <Meta label={t("studio.bitrate")} value={m.bitrateKbps ? `${m.bitrateKbps.toLocaleString()} kbps` : "—"} />
          <Meta label={t("studio.size")} value={formatBytes(size)} />
          <Meta label={t("studio.audio")} value={m.hasAudio ? t("studio.audioYes") : t("studio.audioNo")} />
          {m.rotationDeg !== 0 && <Meta label={t("studio.rotation")} value={t("studio.degrees", { value: m.rotationDeg })} />}
        </dl>
      </CardContent>
    </Card>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="truncate font-medium text-text" title={value}>
        {value}
      </dd>
    </div>
  );
}
