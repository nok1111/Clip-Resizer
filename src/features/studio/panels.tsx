import { useState, type FC } from "react";
import { useTranslation } from "react-i18next";
import * as lucideIcons from "lucide-react";
import { ipc } from "@/lib/ipc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { AspectPreset, AudioMode, QualityPreset, VideoCodec } from "@/lib/ipc";
import { ASPECT_CANVAS, useStudioStore, specCanvas } from "@/stores/studio";

export function FormatPanel() {
  const { t } = useTranslation();
  const spec = useStudioStore((s) => s.spec);
  const setSpec = useStudioStore((s) => s.setSpec);
  const canvas = specCanvas(spec);
  const presets = Object.keys(ASPECT_CANVAS) as Exclude<AspectPreset, "custom">[];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{t("studio.format")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-4 gap-1.5">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setSpec({ preset: p })}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border px-1.5 py-2 text-[11px] transition-colors cursor-pointer",
                spec.preset === p
                  ? "border-accent bg-accent/10 text-text"
                  : "border-border bg-bg-secondary text-text-secondary hover:text-text",
              )}
            >
              <span
                className="rounded-[3px] border border-current opacity-70"
                style={{
                  width: Math.max(10, Math.round((18 * ASPECT_CANVAS[p].width) / Math.max(ASPECT_CANVAS[p].width, ASPECT_CANVAS[p].height))),
                  height: Math.max(10, Math.round((18 * ASPECT_CANVAS[p].height) / Math.max(ASPECT_CANVAS[p].width, ASPECT_CANVAS[p].height))),
                }}
              />
              {p}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSpec({ preset: "custom" })}
            className={cn(
              "flex flex-col items-center justify-center gap-1 rounded-lg border px-1.5 py-2 text-[11px] transition-colors cursor-pointer",
              spec.preset === "custom"
                ? "border-accent bg-accent/10 text-text"
                : "border-border bg-bg-secondary text-text-secondary hover:text-text",
            )}
          >
            {t("studio.custom")}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={16}
            max={7680}
            step={2}
            disabled={spec.preset !== "custom"}
            value={spec.custom.width}
            onChange={(e) => setSpec({ custom: { ...spec.custom, width: even(e.target.value, spec.custom.width) } })}
            className="w-24"
            aria-label={t("studio.width")}
          />
          <span className="text-text-secondary">×</span>
          <Input
            type="number"
            min={16}
            max={7680}
            step={2}
            disabled={spec.preset !== "custom"}
            value={spec.custom.height}
            onChange={(e) => setSpec({ custom: { ...spec.custom, height: even(e.target.value, spec.custom.height) } })}
            className="w-24"
            aria-label={t("studio.height")}
          />
          <span className="ml-auto text-xs tabular-nums text-text-secondary">
            {canvas.width}×{canvas.height}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export function FitPanel() {
  const { t } = useTranslation();
  const spec = useStudioStore((s) => s.spec);
  const setSpec = useStudioStore((s) => s.setSpec);
  const fill = spec.fit.kind === "fill" ? spec.fit : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{t("studio.framing")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Segmented
          value={spec.fit.kind}
          onValueChange={(kind) =>
            setSpec({
              fit:
                kind === "fill"
                  ? { kind: "fill", offset_x: 0, offset_y: 0, zoom: 1 }
                  : { kind: "fit", zoom: 1, offset_x: 0, offset_y: 0 },
            })
          }
          options={[
            { value: "fit", label: t("studio.fitMode") },
            { value: "fill", label: t("studio.fillMode") },
          ]}
          aria-label={t("studio.framing")}
        />
        {fill ? (
          <>
            <Range label={t("studio.zoom")} min={0.1} max={8} step={0.05} value={fill.zoom}
              onChange={(zoom) => setSpec({ fit: { ...fill, zoom } })} />
            <Range label={t("studio.offset_x")} min={-1} max={1} step={0.02} value={fill.offset_x}
              onChange={(offset_x) => setSpec({ fit: { ...fill, offset_x } })} />
            <Range label={t("studio.offset_y")} min={-1} max={1} step={0.02} value={fill.offset_y}
              onChange={(offset_y) => setSpec({ fit: { ...fill, offset_y } })} />
          </>
        ) : (
          <>
            <Segmented
              value={spec.background.kind}
              onValueChange={(kind) =>
                setSpec({
                  background:
                    kind === "blur"
                      ? { kind: "blur", sigma: 20, dim: 0.35 }
                      : kind === "image"
                        ? { kind: "image", path: spec.background.kind === "image" ? spec.background.path : "", blur: 0 }
                        : { kind: "solid", color: "#101418" },
                })
              }
              options={[
                { value: "blur", label: t("studio.bgBlur") },
                { value: "solid", label: t("studio.bgSolid") },
                { value: "image", label: t("studio.bgImage") },
              ]}
              aria-label={t("studio.background")}
            />
            {spec.background.kind === "image" && (
              <>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void (async () => {
                      const { open } = await import("@tauri-apps/plugin-dialog");
                      const p = await open({ filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "bmp"] }] });
                      if (typeof p === "string" && spec.background.kind === "image") {
                        setSpec({ background: { ...spec.background, path: p } });
                      }
                    })()}
                    className="rounded-md border border-border bg-bg-secondary px-2.5 py-1.5 text-xs text-text hover:bg-bg cursor-pointer"
                  >
                    {t("studio.pickImage")}
                  </button>
                  <span className="min-w-0 flex-1 truncate text-xs text-text-secondary" title={spec.background.path}>
                    {spec.background.path ? spec.background.path.split(/[\\/]/).pop() : t("studio.noImage")}
                  </span>
                </div>
                {spec.background.path !== "" && (
                  <Range label={t("studio.blurSigma")} min={0} max={40} step={1} value={spec.background.blur}
                    onChange={(blur) => setSpec({ background: spec.background.kind === "image" ? { ...spec.background, blur } : spec.background })} />
                )}
              </>
            )}
            <Range
              label={t("studio.zoom")}
              min={0.5}
              max={8}
              step={0.05}
              value={spec.fit.kind === "fit" ? spec.fit.zoom : 1}
              onChange={(zoom) =>
                setSpec({
                  fit: spec.fit.kind === "fit" ? { ...spec.fit, zoom } : spec.fit,
                })
              }
            />
            <Range label={t("studio.offset_x")} min={-1} max={1} step={0.02}
              value={spec.fit.kind === "fit" ? spec.fit.offset_x : 0}
              onChange={(offset_x) =>
                setSpec({ fit: spec.fit.kind === "fit" ? { ...spec.fit, offset_x } : spec.fit })
              } />
            <Range label={t("studio.offset_y")} min={-1} max={1} step={0.02}
              value={spec.fit.kind === "fit" ? spec.fit.offset_y : 0}
              onChange={(offset_y) =>
                setSpec({ fit: spec.fit.kind === "fit" ? { ...spec.fit, offset_y } : spec.fit })
              } />
            <Range label={t("studio.margin")} min={0} max={0.3} step={0.01} value={spec.margin}
              onChange={(margin) => setSpec({ margin })} />
            <Range label={t("studio.borderPx")} min={0} max={24} step={1} value={spec.border[0]}
              onChange={(b) => setSpec({ border: [b, spec.border[1]] })} />
            {spec.border[0] > 0 && (
              <label className="flex items-center gap-3 text-xs text-text-secondary">
                {t("studio.borderColor")}
                <input
                  type="color"
                  value={spec.border[1]}
                  onChange={(e) => setSpec({ border: [spec.border[0], e.target.value] })}
                  className="h-8 w-14 cursor-pointer rounded border border-border bg-transparent"
                />
              </label>
            )}
            {spec.background.kind === "solid" && (
              <label className="flex items-center gap-3 text-xs text-text-secondary">
                {t("studio.bgColor")}
                <input
                  type="color"
                  value={spec.background.color}
                  onChange={(e) => setSpec({ background: { kind: "solid", color: e.target.value } })}
                  className="h-8 w-14 cursor-pointer rounded border border-border bg-transparent"
                />
              </label>
            )}
            {spec.background.kind === "blur" && (
              <>
                <Range label={t("studio.blurSigma")} min={2} max={60} step={1} value={spec.background.sigma}
                  onChange={(sigma) => setSpec({ background: { kind: "blur", sigma, dim: spec.background.kind === "blur" ? spec.background.dim : 0.35 } })} />
                <Range label={t("studio.blurDim")} min={0} max={0.9} step={0.05} value={spec.background.dim}
                  onChange={(dim) => setSpec({ background: { kind: "blur", sigma: spec.background.kind === "blur" ? spec.background.sigma : 20, dim } })} />
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function ExportPanel() {
  const { t } = useTranslation();
  const spec = useStudioStore((s) => s.spec);
  const setSpec = useStudioStore((s) => s.setSpec);
  const encoder = useStudioStore((s) => s.encoderName);
  const e = spec.export;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{t("studio.export")}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        <Field label={t("studio.codec")}>
          <Select<VideoCodec>
            value={e.codec}
            onValueChange={(codec) => setSpec({ export: { ...e, codec } })}
            options={[
              { value: "h264", label: "H.264" },
              { value: "h265", label: "H.265" },
            ]}
            aria-label={t("studio.codec")}
            className="w-full min-w-0"
          />
        </Field>
        <Field label={t("studio.quality")}>
          <Select<QualityPreset>
            value={e.quality}
            onValueChange={(quality) => setSpec({ export: { ...e, quality } })}
            options={[
              { value: "fast", label: t("studio.qFast") },
              { value: "balanced", label: t("studio.qBalanced") },
              { value: "high", label: t("studio.qHigh") },
            ]}
            aria-label={t("studio.quality")}
            className="w-full min-w-0"
          />
        </Field>
        <Field label={t("studio.fpsOut")}>
          <Select<string>
            value={e.fps === null ? "keep" : String(e.fps)}
            onValueChange={(v) => setSpec({ export: { ...e, fps: v === "keep" ? null : Number(v) } })}
            options={[
              { value: "keep", label: t("studio.fpsKeep") },
              ...["24", "25", "30", "50", "60"].map((f) => ({ value: f, label: f })),
            ]}
            aria-label={t("studio.fpsOut")}
            className="w-full min-w-0"
          />
        </Field>
        <Field label={t("studio.bitrateKbps")}>
          <Input
            type="number"
            min={0}
            step={500}
            placeholder={t("studio.bitrateAuto")}
            value={e.bitrateKbps ?? ""}
            onChange={(v2) =>
              setSpec({
                export: { ...e, bitrateKbps: v2.target.value === "" ? null : Math.max(200, Number(v2.target.value) || 0) },
              })
            }
            className="w-full"
          />
        </Field>
        <Field label={t("studio.audio")}>
          <Select<AudioMode>
            value={e.audio}
            onValueChange={(audio) => setSpec({ export: { ...e, audio } })}
            options={[
              { value: "copy", label: t("studio.audioCopy") },
              { value: "aac", label: "AAC" },
              { value: "remove", label: t("studio.audioRemove") },
            ]}
            aria-label={t("studio.audio")}
            className="w-full min-w-0"
          />
        </Field>
        <p className="col-span-2 text-xs text-text-secondary">
          {t("studio.encoder", { name: encoder ?? "—" })}
        </p>
      </CardContent>
    </Card>
  );
}

export function GuidesPanel() {
  const { t } = useTranslation();
  const spec = useStudioStore((s) => s.spec);
  const setSpec = useStudioStore((s) => s.setSpec);
  const g = spec.guides;
  const toggle = (k: "safe" | "thirds" | "center" | "export") =>
    setSpec({ guides: { ...g, [k]: !g[k] } });
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{t("studio.guides")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {(
          [
            ["safe", "studio.guideSafe"],
            ["thirds", "studio.guideThirds"],
            ["center", "studio.guideCenter"],
            ["export", "studio.guideExport"],
          ] as const
        ).map(([k, key]) => (
          <label key={k} className="flex cursor-pointer items-center gap-2.5 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={g[k]}
              onChange={() => toggle(k)}
              className="size-3.5 accent-[var(--cr-accent)]"
            />
            {t(key)}
          </label>
        ))}
      </CardContent>
    </Card>
  );
}

export function OverlayPanel() {
  const { t } = useTranslation();
  const spec = useStudioStore((s) => s.spec);
  const setSpec = useStudioStore((s) => s.setSpec);
  const ov = spec.overlay;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{t("studio.overlay")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              void (async () => {
                const { open } = await import("@tauri-apps/plugin-dialog");
                const p = await open({
                  filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "avi", "m4v", "ts", "wmv"] }],
                });
                if (typeof p === "string") {
                  setSpec({
                    overlay: { path: p, scale: ov?.scale ?? 0.35, offsetX: ov?.offsetX ?? 0.7, offsetY: ov?.offsetY ?? 0.7 },
                  });
                }
              })()
            }
            className="rounded-md border border-border bg-bg-secondary px-2.5 py-1.5 text-xs text-text hover:bg-bg cursor-pointer"
          >
            {t("studio.overlayPick")}
          </button>
          <span className="min-w-0 flex-1 truncate text-xs text-text-secondary" title={ov?.path ?? ""}>
            {ov?.path ? ov.path.split(/[\\/]/).pop() : t("studio.overlayNone")}
          </span>
          {ov && (
            <Button variant="ghost" size="sm" onClick={() => setSpec({ overlay: null })}>
              {t("studio.overlayOff")}
            </Button>
          )}
        </div>
        {ov && (
          <>
            <Range label={t("studio.overlayScale")} min={0.05} max={1} step={0.05} value={ov.scale}
              onChange={(scale) => setSpec({ overlay: { ...ov, scale } })} />
            <Range label={t("studio.offset_x")} min={-1} max={1} step={0.02} value={ov.offsetX}
              onChange={(offsetX) => setSpec({ overlay: { ...ov, offsetX } })} />
            <Range label={t("studio.offset_y")} min={-1} max={1} step={0.02} value={ov.offsetY}
              onChange={(offsetY) => setSpec({ overlay: { ...ov, offsetY } })} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

const STICKER_ICONS = [
  "Heart", "ThumbsUp", "ThumbsDown", "Laugh", "Frown", "Star",
  "Zap", "Flame", "Angry", "Smile", "Meh", "Eye",
  "Bell", "BellRing", "Check", "X", "Play", "Pause",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "AlertTriangle", "Sparkles",
] as const;

async function rasterizeIcon(name: string, color: string): Promise<ArrayBuffer> {
  const { createElement } = await import("react");
  const { flushSync } = await import("react-dom");
  const { createRoot } = await import("react-dom/client");
  const icons = (await import("lucide-react")) as unknown as Record<string, FC<{ size?: number; color?: string }>>;
  const Icon = icons[name];
  if (!Icon) throw new Error(`icon ${name} not found`);
  const div = document.createElement("div");
  flushSync(() => createRoot(div).render(createElement(Icon, { size: 256, color })));
  const svg = div.querySelector("svg")?.outerHTML;
  if (!svg) throw new Error("icon render failed");
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  c.getContext("2d")!.drawImage(img, 0, 0, 256, 256);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
  if (!blob) throw new Error("toBlob failed");
  return blob.arrayBuffer();
}

export function StickerPanel() {
  const { t } = useTranslation();
  const spec = useStudioStore((s) => s.spec);
  const setSpec = useStudioStore((s) => s.setSpec);
  const st = spec.sticker;
  const [busy, setBusy] = useState(false);
  const place = (path: string) =>
    setSpec({ sticker: { path, scale: st?.scale ?? 0.2, offsetX: st?.offsetX ?? -0.7, offsetY: st?.offsetY ?? -0.7 } });
  const pickIcon = async (name: string) => {
    setBusy(true);
    try {
      const buf = await rasterizeIcon(name, "#ffffff");
      const p = await ipc.saveStickerPng(`icon_${name}`, Array.from(new Uint8Array(buf)));
      place(p);
    } finally {
      setBusy(false);
    }
  };
  const pickImage = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const p = await open({ filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] }] });
    if (typeof p === "string") place(p);
  };
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{t("studio.sticker")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-6 gap-1">
          {STICKER_ICONS.map((n) => {
            const Ico = (lucideIcons as unknown as Record<string, FC<{ size?: number }>>)[n];
            return (
              <button
                key={n}
                type="button"
                disabled={busy}
                title={n}
                onClick={() => void pickIcon(n)}
                className="flex aspect-square items-center justify-center rounded-md border border-border bg-bg-secondary text-text-secondary hover:border-accent hover:text-text cursor-pointer disabled:opacity-40"
              >
                {Ico ? <Ico size={16} /> : n[0]}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void pickImage()}
            className="rounded-md border border-border bg-bg-secondary px-2.5 py-1.5 text-xs text-text hover:bg-bg cursor-pointer">
            {t("studio.stickerImport")}
          </button>
          <span className="min-w-0 flex-1 truncate text-xs text-text-secondary" title={st?.path ?? ""}>
            {st?.path ? st.path.split(/[\\/]/).pop() : t("studio.stickerNone")}
          </span>
          {st && (
            <Button variant="ghost" size="sm" onClick={() => setSpec({ sticker: null })}>
              {t("studio.overlayOff")}
            </Button>
          )}
        </div>
        {st && (
          <>
            <Range label={t("studio.overlayScale")} min={0.05} max={1} step={0.05} value={st.scale}
              onChange={(scale) => setSpec({ sticker: { ...st, scale } })} />
            <Range label={t("studio.offset_x")} min={-1} max={1} step={0.02} value={st.offsetX}
              onChange={(offsetX) => setSpec({ sticker: { ...st, offsetX } })} />
            <Range label={t("studio.offset_y")} min={-1} max={1} step={0.02} value={st.offsetY}
              onChange={(offsetY) => setSpec({ sticker: { ...st, offsetY } })} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function even(v: string, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(16, Math.round(n / 2) * 2);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      {children}
    </div>
  );
}

function Range({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3 text-xs text-text-secondary">
      <span className="w-16 shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer accent-[var(--cr-accent)]"
      />
      <span className="w-10 text-right tabular-nums text-text">{value.toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)}</span>
    </label>
  );
}
