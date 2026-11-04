import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Clapperboard, Crop, FilePlus2, MonitorPlay, PackageCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useSettingsStore } from "@/stores/settings";

export function DashboardPage() {
  const { t } = useTranslation();
  const appInfo = useSettingsStore((s) => s.appInfo);
  const ffmpegOk = appInfo?.ffmpegAvailable ?? false;

  return (
    <div>
      <PageHeader title={t("nav.dashboard")} description={t("dashboard.welcomeBody")} />
      <div className="grid gap-4 px-8 pb-8 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.welcomeTitle")}</CardTitle>
            <CardDescription>{t("dashboard.version", { version: appInfo?.version ?? "—" })}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div
              className="flex items-center gap-2 rounded-lg border border-border bg-bg-secondary px-3 py-2.5 text-sm"
              role="status"
            >
              {ffmpegOk ? (
                <>
                  <CheckCircle2 className="size-4 text-success" />
                  <span className="text-text">{t("dashboard.ffmpegOk")}</span>
                  <span className="ml-auto truncate text-xs text-text-secondary" title={appInfo?.ffmpegVersion ?? ""}>
                    {appInfo?.ffmpegVersion?.split(" ")[2] ?? ""}
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="size-4 text-danger" />
                  <span className="text-danger">{t("dashboard.ffmpegMissing")}</span>
                </>
              )}
            </div>
            <div className="flex gap-2">
              <Button asChild disabled={!ffmpegOk}>
                <Link to="/studio">
                  <FilePlus2 />
                  {t("dashboard.startImport")}
                </Link>
              </Button>
              <Button variant="secondary" asChild>
                <Link to="/studio">{t("dashboard.openStudio")}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.howTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Step icon={Clapperboard} title={t("dashboard.how1Title")} body={t("dashboard.how1Body")} />
            <Step icon={Crop} title={t("dashboard.how2Title")} body={t("dashboard.how2Body")} />
            <Step icon={PackageCheck} title={t("dashboard.how3Title")} body={t("dashboard.how3Body")} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("nav.studio")}</CardTitle>
            <CardDescription>{t("modules.studio")}</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-3 text-sm text-text-secondary">
            <MonitorPlay className="size-5 text-accent" />
            {t("studio.exportSoon")}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Step({ icon: Icon, title, body }: { icon: typeof Clapperboard; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/15">
        <Icon className="size-4.5 text-accent" />
      </div>
      <div>
        <p className="text-sm font-medium text-text">{title}</p>
        <p className="text-xs text-text-secondary">{body}</p>
      </div>
    </div>
  );
}
