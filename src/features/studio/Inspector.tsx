import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { FolderOpen, ListPlus, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatBytes } from "@/lib/format";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings";
import { useStudioStore } from "@/stores/studio";
import { BackgroundPanel, ExportPanel, FramingPanel, GuidesPanel, OverlayPanel, WatermarkPanel } from "./panels";

type Tab = "framing" | "background" | "layers" | "export";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "framing", label: "studio.framing" },
  { id: "background", label: "studio.background" },
  { id: "layers", label: "studio.layers" },
  { id: "export", label: "studio.export" },
];

/** Fixed right column: tabbed settings + an always-visible export footer. */
export function Inspector() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("framing");
  return (
    <Card className="flex w-[336px] shrink-0 flex-col overflow-hidden p-0">
      <div role="tablist" className="grid grid-cols-4 border-b border-border">
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => setTab(x.id)}
            className={cn(
              "border-b-2 px-1 py-2.5 text-xs font-medium transition-colors cursor-pointer",
              tab === x.id ? "border-accent text-text" : "border-transparent text-text-secondary hover:text-text",
            )}
          >
            {t(x.label)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4" role="tabpanel">
        <div className="flex flex-col gap-5">
          {tab === "framing" && (
            <>
              <FramingPanel />
              <GuidesPanel />
            </>
          )}
          {tab === "background" && <BackgroundPanel />}
          {tab === "layers" && (
            <>
              <OverlayPanel />
              <WatermarkPanel />
            </>
          )}
          {tab === "export" && <ExportPanel />}
        </div>
      </div>
      <ExportFooter />
    </Card>
  );
}

function ExportFooter() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const render = useStudioStore((s) => s.render);
  const e = useStudioStore((s) => s.spec.export);
  const encoder = useStudioStore((s) => s.encoderName);
  const startRender = useStudioStore((s) => s.startRender);
  const cancelRender = useStudioStore((s) => s.cancelRender);
  const enqueueAll = useStudioStore((s) => s.enqueueAll);
  const canExport = useStudioStore((s) => s.items.some((i) => i.path === s.selected && i.status === "ready"));
  const ready = useStudioStore((s) => s.items.filter((i) => i.status === "ready").length);
  const dir = useSettingsStore((s) => s.settings?.defaultOutputDir ?? null);
  const updateSettings = useSettingsStore((s) => s.update);

  // Resolve the real encoder name once (setSpec does it on codec change).
  useEffect(() => {
    if (!useStudioStore.getState().encoderName) useStudioStore.getState().setSpec({});
  }, []);

  const pickDir = async () => {
    const p = await ipc.pickOutputDir();
    if (p) await updateSettings({ defaultOutputDir: p });
  };
  const quality = { fast: t("studio.qFast"), balanced: t("studio.qBalanced"), high: t("studio.qHigh") }[e.quality];

  return (
    <div className="flex flex-col gap-2 border-t border-border bg-bg-secondary/60 p-3">
      <div className="flex items-center gap-2 text-xs">
        <FolderOpen className="size-3.5 shrink-0 text-text-secondary" />
        <span className="min-w-0 flex-1 truncate text-text-secondary" title={dir ?? t("studio.noOutputDir")}>
          {dir ? dir.split(/[\\/]/).filter(Boolean).pop() : t("studio.noOutputDir")}
        </span>
        <button type="button" onClick={() => void pickDir()} className="shrink-0 text-accent hover:underline cursor-pointer">
          {t("studio.change")}
        </button>
      </div>
      <p className="text-[11px] text-text-secondary">
        {e.codec === "h264" ? "H.264" : "H.265"} · {encoder ?? "—"} · {quality}
      </p>
      {render.running && (
        <div>
          <div className="h-1.5 overflow-hidden rounded-full bg-bg">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${render.pct}%` }} />
          </div>
          <p className="mt-1 text-[11px] tabular-nums text-text-secondary">
            {render.pct.toFixed(0)}% · {render.speed.toFixed(1)}×
          </p>
        </div>
      )}
      {render.error && <p className="line-clamp-3 text-xs text-danger" title={render.error}>{render.error}</p>}
      {render.cancelled && <p className="text-xs text-warning">{t("render.cancelled")}</p>}
      {render.skipped && <p className="text-xs text-warning">{t("render.skipped")}</p>}
      {render.donePath && (
        <button
          type="button"
          onClick={() => void ipc.revealPath(render.donePath!).catch(() => undefined)}
          title={render.donePath}
          className="min-w-0 truncate text-left text-xs text-success hover:underline cursor-pointer"
        >
          {t("render.done", { bytes: formatBytes(render.doneBytes) })} · {t("studio.reveal")}
        </button>
      )}
      {render.running ? (
        <Button variant="danger" className="w-full" onClick={() => void cancelRender()}>
          {t("render.cancel")}
        </Button>
      ) : (
        <Button variant="gradient" className="w-full" disabled={!canExport} onClick={() => void startRender()}>
          <Zap />
          {t("studio.exportVideo")}
        </Button>
      )}
      <Button
        variant="secondary"
        size="sm"
        className="w-full"
        disabled={ready === 0 || render.running}
        onClick={() => void enqueueAll().then((ok) => ok && navigate("/queue"))}
      >
        <ListPlus />
        {t("studio.enqueueAll", { count: ready })}
      </Button>
    </div>
  );
}
