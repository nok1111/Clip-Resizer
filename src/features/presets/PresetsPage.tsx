import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BookmarkPlus, Check, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { BookMarked } from "lucide-react";
import { errorMessage, ipc } from "@/lib/ipc";
import { useStudioStore, type StudioSpec } from "@/stores/studio";

export function PresetsPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<[string, string][]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [edition, setEdition] = useState<string | null>(null);
  const spec = useStudioStore((s) => s.spec);
  const setSpec = useStudioStore((s) => s.setSpec);

  const reload = () =>
    ipc.listPresets().then(setRows).catch((e) => setError(errorMessage(e)));

  useEffect(() => {
    void reload();
    void ipc.edition().then(setEdition).catch(() => setEdition(null));
  }, []);

  const save = async () => {
    setError(null);
    try {
      await ipc.savePreset(name.trim(), JSON.stringify(spec));
      setName("");
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const apply = (specJson: string) => {
    try {
      const s = JSON.parse(specJson) as StudioSpec;
      setSpec(s);
    } catch {
      setError(t("presets.badSpec"));
    }
  };

  const remove = async (n: string) => {
    try {
      await ipc.deletePreset(n);
      await reload();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div>
      <PageHeader title={t("nav.presets")} />
      <div className="flex max-w-2xl flex-col gap-4 px-8 pb-8">
        {edition === "free" && (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            {t("presets.proOnly")}
          </p>
        )}
        <Card>
          <CardContent className="flex items-end gap-2 pt-4">
            <div className="flex-1">
              <span className="mb-1.5 block text-xs font-medium text-text-secondary">
                {t("presets.saveCurrent")}
              </span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("presets.namePh")}
                maxLength={60}
              />
            </div>
            <Button onClick={() => void save()} disabled={!name.trim()}>
              <BookmarkPlus />
              {t("presets.save")}
            </Button>
          </CardContent>
        </Card>
        {error && <p className="text-xs text-danger">{error}</p>}
        {rows.length === 0 ? (
          <EmptyState icon={BookMarked} title={t("presets.empty")} body={t("presets.emptyHint")} />
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map(([n, specJson]) => (
              <Card key={n} className="p-0">
                <CardContent className="flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{n}</span>
                  <Button variant="secondary" size="sm" onClick={() => apply(specJson)}>
                    <Check />
                    {t("presets.apply")}
                  </Button>
                  <Button variant="ghost" size="icon" title={t("presets.delete")} onClick={() => void remove(n)}>
                    <Trash2 />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
