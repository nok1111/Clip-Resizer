import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FilePlus2, FolderPlus, Loader2, Trash2, Upload } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings";
import { useStudioStore } from "@/stores/studio";
import { VideoList } from "./VideoList";
import { PreviewPane } from "./PreviewPane";

const VIDEO_EXTENSIONS = ["mp4", "mov", "mkv", "avi", "webm", "m4v"];

export function StudioPage() {
  const { t } = useTranslation();
  const s = useStudioStore();
  const ffmpegOk = useSettingsStore((st) => st.appInfo?.ffmpegAvailable ?? false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    try {
      void getCurrentWebview()
        .onDragDropEvent((e) => {
          if (e.payload.type === "enter" || e.payload.type === "over") setDragging(true);
          else if (e.payload.type === "leave") setDragging(false);
          else if (e.payload.type === "drop") {
            setDragging(false);
            void useStudioStore.getState().addPaths(e.payload.paths);
          }
        })
        .then((fn) => (disposed ? fn() : (unlisten = fn)));
    } catch {
      // Not running inside Tauri (e.g. unit tests).
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const addFiles = async () => {
    const picked = await open({
      multiple: true,
      filters: [{ name: t("studio.videos"), extensions: VIDEO_EXTENSIONS }],
    });
    if (picked) await s.addPaths(Array.isArray(picked) ? picked : [picked]);
  };
  const addFolder = async () => {
    const picked = await open({ directory: true, multiple: true });
    if (picked) await s.addPaths(Array.isArray(picked) ? picked : [picked]);
  };

  const busy = s.scanning;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t("nav.studio")}
        description={t("modules.studio")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="gradient" onClick={() => void addFiles()} disabled={busy || !ffmpegOk}>
              <FilePlus2 />
              {t("studio.addVideos")}
            </Button>
            <Button variant="secondary" onClick={() => void addFolder()} disabled={busy || !ffmpegOk}>
              <FolderPlus />
              {t("studio.addFolder")}
            </Button>
            <Button variant="ghost" onClick={s.clear} disabled={busy || s.items.length === 0}>
              <Trash2 />
              {t("studio.clear")}
            </Button>
            <span className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-text-secondary" aria-live="polite">
              {busy ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="size-3.5 animate-spin" />
                  {t("studio.scanning")}
                </span>
              ) : (
                s.scanNotice ? (
                  <>
                    {t("studio.added", { count: s.scanNotice.added })}
                    {s.scanNotice.duplicates > 0 && ` · ${t("studio.duplicates", { count: s.scanNotice.duplicates })}`}
                    {s.scanNotice.rejected > 0 && ` · ${t("studio.unsupported", { count: s.scanNotice.rejected })}`}
                    {s.scanNotice.truncated && ` · ${t("studio.truncated")}`}
                  </>
                ) : (
                  t("studio.added", { count: s.items.length })
                )
              )}
            </span>
          </div>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-8 pb-6">

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(380px,5fr)_minmax(420px,7fr)]">
          <Card className={cn("relative min-h-0 overflow-hidden p-0", dragging && "ring-2 ring-accent")}>
            {s.items.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
                <Upload className="size-8 text-text-secondary/60" />
                <p className="text-sm font-medium text-text">{t("studio.dropHint")}</p>
                <p className="max-w-xs text-xs text-text-secondary">{t("studio.dropSub")}</p>
              </div>
            ) : (
              <VideoList />
            )}
          </Card>
          <PreviewPane />
        </div>
      </div>
    </div>
  );
}
