import { useTranslation } from "react-i18next";
import { Check, FolderOpen, RotateCcw } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES } from "@/i18n";
import { errorMessage, ipc, type Language, type LicenseStatus, type Theme } from "@/lib/ipc";
import { useSettingsStore } from "@/stores/settings";
import { useEffect, useState } from "react";

export function SettingsPage() {
  const { t } = useTranslation();
  const { settings, appInfo, update, reset, saving, lastSavedAt, error } = useSettingsStore();
  const [resetBusy, setResetBusy] = useState(false);
  const [license, setLicense] = useState<LicenseStatus | null>(null);
  const [licenseKeyInput, setLicenseKeyInput] = useState("");
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [licenseError, setLicenseError] = useState<string | null>(null);

  useEffect(() => {
    void ipc.licenseStatus().then(setLicense).catch(() => setLicense(null));
  }, []);

  if (!settings) return null;

  const set = (patch: Parameters<typeof update>[0]) => void update(patch);

  const chooseDir = async () => {
    try {
      const dir = await ipc.pickOutputDir();
      if (dir) set({ defaultOutputDir: dir });
    } catch {
      /* dialog errors surface via update() if the value were invalid */
    }
  };

  const activateLicense = async (key: string) => {
    setLicenseBusy(true);
    setLicenseError(null);
    try {
      setLicense(await ipc.licenseActivate(key));
      setLicenseKeyInput("");
      void update({ licenseKey: key });
    } catch (e) {
      setLicenseError(String(e).includes("invalid_license") ? t("settings.licenseInvalid") : errorMessage(e));
    } finally {
      setLicenseBusy(false);
    }
  };

  const deactivateLicense = async () => {
    setLicenseBusy(true);
    setLicenseError(null);
    try {
      setLicense(await ipc.licenseDeactivate());
      void update({ licenseKey: null });
    } catch (e) {
      setLicenseError(errorMessage(e));
    } finally {
      setLicenseBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title={t("nav.settings")} />
      <div className="flex max-w-3xl flex-col gap-4 px-8 pb-8">
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.appearance")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Field label={t("settings.theme")}>
              <Segmented<Theme>
                value={settings.theme}
                onValueChange={(theme) => set({ theme })}
                options={[
                  { value: "dark", label: t("settings.themeDark") },
                  { value: "light", label: t("settings.themeLight") },
                ]}
                aria-label={t("settings.theme")}
              />
            </Field>
            <Field label={t("settings.language")}>
              <Select<Language>
                value={settings.language}
                onValueChange={(language) => set({ language })}
                options={[
                  { value: "system", label: t("settings.languageSystem") },
                  ...SUPPORTED_LOCALES.map((l) => ({ value: l as Language, label: LOCALE_NATIVE_NAMES[l] })),
                ]}
                aria-label={t("settings.language")}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("settings.license")}</CardTitle>
            <CardDescription>{t("settings.licenseHint")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-text-secondary">{t("settings.editionLabel")}</span>
              <span className={license?.edition === "pro" ? "font-medium text-success" : "font-medium"}>
                {license?.edition === "pro" ? "Pro" : "Free"}
              </span>
              {license?.keyId && <span className="text-xs text-text-secondary">· {license.keyId}</span>}
            </div>
            {license?.activated ? (
              <div>
                <Button variant="secondary" size="sm" disabled={licenseBusy} onClick={() => void deactivateLicense()}>
                  {t("settings.licenseDeactivate")}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  value={licenseKeyInput}
                  onChange={(e) => setLicenseKeyInput(e.target.value)}
                  placeholder={t("settings.licensePlaceholder")}
                  className="max-w-md font-mono text-xs"
                  aria-label={t("settings.license")}
                />
                <Button
                  size="sm"
                  disabled={licenseBusy || !licenseKeyInput.trim()}
                  onClick={() => void activateLicense(licenseKeyInput.trim())}
                >
                  {t("settings.licenseActivate")}
                </Button>
              </div>
            )}
            {licenseError && <p className="text-[11px] text-danger">{licenseError}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("settings.processing")}</CardTitle>
            <CardDescription>{t("settings.concurrentRendersHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Field label={t("settings.concurrentRenders")}>
              <Input
                type="number"
                min={0}
                max={3}
                className="w-24"
                value={settings.concurrentRenders}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 0 && n <= 3) set({ concurrentRenders: n });
                }}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("settings.output")}</CardTitle>
            <CardDescription>{t("settings.defaultOutputDirHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Field label={t("settings.defaultOutputDir")}>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={settings.defaultOutputDir ?? ""}
                  placeholder={t("settings.notSet")}
                  className="max-w-md"
                />
                <Button variant="secondary" size="sm" onClick={() => void chooseDir()}>
                  {t("settings.choose")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!settings.defaultOutputDir}
                  onClick={() => void ipc.openOutputDir().catch(() => undefined)}
                >
                  <FolderOpen />
                  {t("settings.open")}
                </Button>
              </div>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("settings.about")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <Row label={t("settings.version")} value={`${appInfo?.name ?? "Clip Resizer"} ${appInfo?.version ?? ""}`} />
            <Row label={t("settings.engine")} value={appInfo?.ffmpegVersion ?? t("settings.engineMissing")} />
            <p className="text-xs text-text-secondary">{t("settings.licenses")}</p>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              setResetBusy(true);
              void reset().finally(() => setResetBusy(false));
            }}
            disabled={saving || resetBusy}
          >
            <RotateCcw />
            {t("settings.reset")}
          </Button>
          <span className="flex items-center gap-1.5 text-xs text-text-secondary" aria-live="polite">
            {saving ? (
              t("settings.saving")
            ) : error ? (
              <span className="text-danger">{errorMessage(error)}</span>
            ) : lastSavedAt ? (
              <span className="flex items-center gap-1 text-success">
                <Check className="size-3.5" />
                {t("settings.saved")}
              </span>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-28 shrink-0 text-xs text-text-secondary">{label}</span>
      <span className="truncate text-text" title={value}>
        {value}
      </span>
    </div>
  );
}
