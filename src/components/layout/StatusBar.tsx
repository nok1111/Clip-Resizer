import { useTranslation } from "react-i18next";
import { CircleCheck, CircleX, Clapperboard, Cpu, FolderOpen } from "lucide-react";
import { ipc } from "@/lib/ipc";
import { useSettingsStore } from "@/stores/settings";
import { useStudioStore } from "@/stores/studio";

export function StatusBar() {
  const { t } = useTranslation();
  const items = useStudioStore((s) => s.items);
  const scanning = useStudioStore((s) => s.scanning);
  const appInfo = useSettingsStore((s) => s.appInfo);
  const defaultDir = useSettingsStore((s) => s.settings?.defaultOutputDir ?? null);

  const probed = items.filter((i) => i.status === "ready").length;
  const failed = items.filter((i) => i.status === "error").length;
  const ffmpegOk = appInfo?.ffmpegAvailable ?? false;

  return (
    <footer className="flex h-9 shrink-0 items-center gap-5 border-t border-border bg-bg-secondary px-4 text-xs text-text-secondary">
      <span className="flex items-center gap-1.5">
        <span
          className={
            scanning
              ? "size-2 animate-pulse rounded-full bg-accent"
              : "size-2 rounded-full bg-text-secondary/50"
          }
        />
        {scanning ? t("status.scanning") : t("status.ready")}
      </span>
      <Stat icon={Clapperboard} label={t("status.videos")} value={items.length} />
      <Stat icon={CircleCheck} label={t("status.probed")} value={probed} />
      <Stat icon={CircleX} label={t("status.failed")} value={failed} />
      <span className="ml-auto flex items-center gap-1.5" title={appInfo?.ffmpegVersion ?? ""}>
        <Cpu className="size-3.5" />
        <span className={ffmpegOk ? "text-success" : "text-danger"}>
          {ffmpegOk ? "FFmpeg" : t("dashboard.ffmpegMissing")}
        </span>
      </span>
      <button
        type="button"
        disabled={!defaultDir}
        onClick={() => void ipc.openOutputDir().catch(() => undefined)}
        title={defaultDir ?? t("status.noOutput")}
        className="flex max-w-64 items-center gap-1.5 truncate rounded px-2 py-1 hover:bg-card hover:text-text disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent cursor-pointer"
      >
        <FolderOpen className="size-3.5 shrink-0" />
        <span className="truncate">{defaultDir ? t("status.openOutput") : t("status.noOutput")}</span>
      </button>
    </footer>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Clapperboard; label: string; value: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon className="size-3.5" />
      {label}: <span className="tabular-nums text-text">{value}</span>
    </span>
  );
}
