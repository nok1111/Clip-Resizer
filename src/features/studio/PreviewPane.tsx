import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Clapperboard, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { aspectLabel, formatBytes, formatDurationMs, formatFps } from "@/lib/format";
import { ipc, videoUrl } from "@/lib/ipc";
import { useStudioStore } from "@/stores/studio";

export function PreviewPane() {
  const { t } = useTranslation();
  const item = useStudioStore((s) => s.items.find((i) => i.path === s.selected));
  /** Path whose <video> element failed (WebView2 codec coverage is limited). */
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
          <video
            key={item.path}
            src={videoUrl(item.path)}
            controls
            className="size-full object-contain"
            onError={() => setPlayErrorPath(item.path)}
          />
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
      </div>

      {item && (
        <div className="border-t border-border px-5 py-4">
          <div className="mb-3 flex items-center gap-2">
            <CardTitle className="truncate">{item.name}</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto shrink-0"
              onClick={() => void ipc.revealPath(item.path).catch(() => undefined)}
            >
              <FolderOpen />
              {t("studio.reveal")}
            </Button>
          </div>
          {item.meta ? (
            <Card className="bg-bg-secondary">
              <CardHeader className="pb-2">
                <CardTitle>{t("studio.metadata")}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
                  <Meta label={t("studio.duration")} value={formatDurationMs(item.meta.durationMs)} />
                  <Meta label={t("studio.resolution")} value={`${item.meta.width}×${item.meta.height} (${aspectLabel(item.meta.width, item.meta.height)})`} />
                  <Meta label={t("studio.fps")} value={formatFps(item.meta.fps)} />
                  <Meta label={t("studio.codec")} value={item.meta.codec} />
                  <Meta
                    label={t("studio.bitrate")}
                    value={item.meta.bitrateKbps ? `${item.meta.bitrateKbps.toLocaleString()} kbps` : "—"}
                  />
                  <Meta label={t("studio.size")} value={formatBytes(item.size)} />
                  <Meta label={t("studio.audio")} value={item.meta.hasAudio ? t("studio.audioYes") : t("studio.audioNo")} />
                  {item.meta.rotationDeg !== 0 && (
                    <Meta label={t("studio.rotation")} value={t("studio.degrees", { value: item.meta.rotationDeg })} />
                  )}
                </dl>
              </CardContent>
            </Card>
          ) : item.status === "error" ? (
            <p className="text-xs text-danger">{t("studio.probeFailed")}</p>
          ) : (
            <p className="text-xs text-text-secondary">{t("studio.probing")}</p>
          )}
          <p className="mt-3 text-xs text-text-secondary/80">{t("studio.exportSoon")}</p>
        </div>
      )}
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
