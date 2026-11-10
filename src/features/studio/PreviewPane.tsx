import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Clapperboard } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useStudioStore } from "@/stores/studio";
import { ComposedPreview } from "./ComposedPreview";
import { FormatBar } from "./panels";

export function PreviewPane() {
  const { t } = useTranslation();
  const item = useStudioStore((s) => s.items.find((i) => i.path === s.selected));
  const [playErrorPath, setPlayErrorPath] = useState<string | null>(null);
  const playError = item != null && playErrorPath === item.path;

  return (
    <Card className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-0">
      <FormatBar />
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
      </div>
    </Card>
  );
}
