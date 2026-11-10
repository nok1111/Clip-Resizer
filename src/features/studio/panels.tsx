import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { SlidersHorizontal } from "lucide-react";
import type { AspectPreset, AudioMode, QualityPreset, VideoCodec } from "@/lib/ipc";
import { ASPECT_CANVAS, useStudioStore, specCanvas } from "@/stores/studio";
import { freshFit, ZOOM_MAX, ZOOM_MIN } from "@/lib/framing";

const PRESET_META: Record<Exclude<AspectPreset, "custom">, { sub: string }> = {
  "9:16": { sub: "vertical" },
  "1:1": { sub: "square" },
  "4:5": { sub: "portrait" },
  "16:9": { sub: "hd" },
  "4:3": { sub: "classic" },
  "3:4": { sub: "portrait" },
};

const RESOLUTIONS: Array<{ key: string; h: number }> = [
  { key: "r4k", h: 2160 },
  { key: "r1080", h: 1080 },
  { key: "r720", h: 720 },
  { key: "r540", h: 540 },
];

/** Output format chips + resolution, shown above the preview. */
export function FormatBar() {
  const { t } = useTranslation();
  const spec = useStudioStore((s) => s.spec);
  const setSpec = useStudioStore((s) => s.setSpec);
  const canvas = specCanvas(spec);
  const presets = Object.keys(ASPECT_CANVAS) as Exclude<AspectPreset, "custom">[];
  const resKey = spec.preset === "custom" ? "custom" : String(canvas.height);

  const setResolution = (h: number) => {
    const ratio = canvas.width / canvas.height;
    const w = Math.round(((h * ratio) / 2)) * 2;
    setSpec({ preset: "custom", custom: { width: w, height: h } });
  };
  const chip = (active: boolean) =>
    cn(
      "flex h-7 items-center gap-1.5 rounded-full border px-2 text-xs font-medium transition-colors cursor-pointer @xl:px-2.5",
      active
        ? "border-accent bg-accent/20 text-text"
        : "border-border bg-bg-secondary text-text-secondary hover:border-accent/50 hover:text-text",
    );

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-2 @xl:gap-1.5 @xl:px-3" data-no-wheel>
      {presets.map((p) => {
        return (
          <button key={p} type="button" title={t(`studio.sub.${PRESET_META[p].sub}`)} onClick={() => setSpec({ preset: p })} className={chip(spec.preset === p)}>
            {p}
          </button>
        );
      })}
      <button type="button" title={t("studio.custom")} aria-label={t("studio.custom")} onClick={() => setSpec({ preset: "custom" })} className={chip(spec.preset === "custom")}>
        <SlidersHorizontal className="size-3.5" />
        <span className="hidden @2xl:inline">{t("studio.custom")}</span>
      </button>
      {spec.preset === "custom" ? (
        <span className="flex items-center gap-1">
          <Input
            type="number" min={16} max={7680} step={2}
            value={spec.custom.width}
            onChange={(e) => setSpec({ custom: { ...spec.custom, width: even(e.target.value, spec.custom.width) } })}
            className="h-7 w-20 text-xs" aria-label={t("studio.width")}
          />
          <span className="text-text-secondary">×</span>
          <Input
            type="number" min={16} max={7680} step={2}
            value={spec.custom.height}
            onChange={(e) => setSpec({ custom: { ...spec.custom, height: even(e.target.value, spec.custom.height) } })}
            className="h-7 w-20 text-xs" aria-label={t("studio.height")}
          />
        </span>
      ) : (
        <Select
          value={RESOLUTIONS.some((r) => String(r.h) === resKey) ? resKey : "custom"}
          onValueChange={(v) => {
            const r = RESOLUTIONS.find((x) => String(x.h) === v);
            if (r) setResolution(r.h);
          }}
          options={[
            ...RESOLUTIONS.map((r) => ({ value: String(r.h), label: t(`studio.res.${r.key}`) })),
            ...(RESOLUTIONS.some((r) => String(r.h) === resKey) ? [] : [{ value: "custom", label: `${canvas.width}×${canvas.height}` }]),
          ]}
          aria-label={t("studio.resolution")}
          className="h-7 w-[100px] min-w-0 px-2 text-xs @2xl:w-auto @2xl:px-3"
        />
      )}
    </div>
  );
}

export function FramingPanel() {
  const { t } = useTranslation();
  const spec = useStudioStore((s) => s.spec);
  const setSpec = useStudioStore((s) => s.setSpec);
  const zoomTo = useStudioStore((s) => s.zoomTo);
  const resetFraming = useStudioStore((s) => s.resetFraming);
  const own = useStudioStore((s) => s.selected != null && s.fitByPath[s.selected] != null);
  const multi = useStudioStore((s) => s.items.length > 1);
  const setFitScope = useStudioStore((s) => s.setFitScope);
  const applyFitToAll = useStudioStore((s) => s.applyFitToAll);
  const framed = spec.fit.kind === "fit";
  return (
    <>
      <Segmented
        value={spec.fit.kind}
        onValueChange={(kind) => setSpec({ fit: freshFit(kind) })}
        options={[
          { value: "fill", label: t("studio.fillMode") },
          { value: "fit", label: t("studio.fitMode") },
        ]}
        aria-label={t("studio.framing")}
      />
      <Section title={t("studio.position")}>
        <Range label={t("studio.zoom")} min={ZOOM_MIN} max={ZOOM_MAX} step={0.01} value={spec.fit.zoom}
          onChange={(zoom) => zoomTo(zoom)} />
        <Range label={t("studio.offsetX")} min={-1} max={1} step={0.01} value={spec.fit.pan_x ?? 0}
          onChange={(pan_x) => setSpec({ fit: { ...spec.fit, pan_x } })} />
        <Range label={t("studio.offsetY")} min={-1} max={1} step={0.01} value={spec.fit.pan_y ?? 0}
          onChange={(pan_y) => setSpec({ fit: { ...spec.fit, pan_y } })} />
        <button
          type="button"
          title={t("studio.framingHint")}
          onClick={resetFraming}
          className="self-start rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text hover:bg-bg cursor-pointer"
        >
          {t("studio.resetFraming")}
        </button>
      </Section>
      {multi && (
        <Section title={t("studio.scopeLabel")}>
          <Segmented
            value={own ? "one" : "all"}
            onValueChange={(v) => setFitScope(v)}
            options={[
              { value: "all", label: t("studio.scopeAll") },
              { value: "one", label: t("studio.scopeOne") },
            ]}
            aria-label={t("studio.scopeLabel")}
          />
          {own && (
            <button type="button" onClick={applyFitToAll}
              className="self-start text-xs text-accent hover:underline cursor-pointer">
              {t("studio.applyToAll")}
            </button>
          )}
        </Section>
      )}
      {framed && (
        <Section title={t("studio.frameOptions")}>
            <Range label={t("studio.margin")} min={0} max={0.3} step={0.01} value={spec.margin}
              onChange={(margin) => setSpec({ margin })} />
            <Range label={t("studio.borderPx")} min={0} max={24} step={1} value={spec.border[0]}
              onChange={(b) => setSpec({ border: [b, spec.border[1]] })} />
            {spec.border[0] > 0 && (
              <ColorRow label={t("studio.borderColor")} value={spec.border[1]}
                onChange={(c) => setSpec({ border: [spec.border[0], c] })} />
            )}
        </Section>
      )}
    </>
  );
}

export function BackgroundPanel() {
  const { t } = useTranslation();
  const spec = useStudioStore((s) => s.spec);
  const setSpec = useStudioStore((s) => s.setSpec);
  const bg = spec.background;
  return (
    <Section title={t("studio.background")}>
      <Segmented
        value={bg.kind === "solid" ? "solid" : "blur"}
        onValueChange={(kind) =>
          setSpec({
            background: kind === "blur" ? { kind: "blur", sigma: 20, dim: 0.35 } : { kind: "solid", color: "#101418" },
          })
        }
        options={[
          { value: "blur", label: t("studio.bgBlur") },
          { value: "solid", label: t("studio.bgSolid") },
        ]}
        aria-label={t("studio.background")}
      />
      {bg.kind === "solid" && (
        <ColorRow label={t("studio.bgColor")} value={bg.color}
          onChange={(color) => setSpec({ background: { kind: "solid", color } })} />
      )}
      {bg.kind === "blur" && (
        <>
          <Range label={t("studio.blurSigma")} min={2} max={60} step={1} value={bg.sigma}
            onChange={(sigma) => setSpec({ background: { kind: "blur", sigma, dim: bg.dim } })} />
          <Range label={t("studio.blurDim")} min={0} max={0.9} step={0.05} value={bg.dim}
            onChange={(dim) => setSpec({ background: { kind: "blur", sigma: bg.sigma, dim } })} />
        </>
      )}
      {spec.fit.kind === "fill" && spec.fit.zoom >= 1 && (
        <p className="text-xs text-text-secondary">{t("studio.bgHiddenFill")}</p>
      )}
    </Section>
  );
}

export function ExportPanel() {
  const { t } = useTranslation();
  const spec = useStudioStore((s) => s.spec);
  const setSpec = useStudioStore((s) => s.setSpec);
  const encoder = useStudioStore((s) => s.encoderName);
  const e = spec.export;

  return (
    <Section title={t("studio.export")} className="grid grid-cols-2 gap-3">
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
      </Section>
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
    <Section title={t("studio.guides")} className="grid grid-cols-2 gap-2">
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
      </Section>
  );
}

export function OverlayPanel() {
  const { t } = useTranslation();
  const spec = useStudioStore((s) => s.spec);
  const setSpec = useStudioStore((s) => s.setSpec);
  const ov = spec.overlay;
  return (
    <Section title={t("studio.overlay")} className="flex flex-col gap-3">
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
            <Range label={t("studio.offsetX")} min={-1} max={1} step={0.02} value={ov.offsetX}
              onChange={(offsetX) => setSpec({ overlay: { ...ov, offsetX } })} />
            <Range label={t("studio.offsetY")} min={-1} max={1} step={0.02} value={ov.offsetY}
              onChange={(offsetY) => setSpec({ overlay: { ...ov, offsetY } })} />
          </>
        )}
      </Section>
  );
}

const WM_POSITIONS: Array<[number, number]> = [
  [-0.85, -0.85], [0, -0.85], [0.85, -0.85],
  [-0.85, 0], [0, 0], [0.85, 0],
  [-0.85, 0.85], [0, 0.85], [0.85, 0.85],
];

export function WatermarkPanel() {
  const { t } = useTranslation();
  const spec = useStudioStore((s) => s.spec);
  const setSpec = useStudioStore((s) => s.setSpec);
  const wm = spec.watermark;
  const place = (path: string) =>
    setSpec({ watermark: { path, scale: wm?.scale ?? 0.25, offsetX: wm?.offsetX ?? 0.85, offsetY: wm?.offsetY ?? 0.85, opacity: wm?.opacity ?? 0.7 } });
  const pickImage = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const p = await open({ filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] }] });
    if (typeof p === "string") place(p);
  };
  return (
    <Section title={t("studio.watermark")} className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void pickImage()}
            className="rounded-md border border-border bg-bg-secondary px-2.5 py-1.5 text-xs text-text hover:bg-bg cursor-pointer">
            {t("studio.watermarkPick")}
          </button>
          <span className="min-w-0 flex-1 truncate text-xs text-text-secondary" title={wm?.path ?? ""}>
            {wm?.path ? wm.path.split(/[\\/]/).pop() : t("studio.watermarkNone")}
          </span>
          {wm && (
            <Button variant="ghost" size="sm" onClick={() => setSpec({ watermark: null })}>
              {t("studio.overlayOff")}
            </Button>
          )}
        </div>
        {wm && (
          <>
            <div className="grid grid-cols-3 gap-1 self-start">
              {WM_POSITIONS.map(([x, y], i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSpec({ watermark: { ...wm, offsetX: x, offsetY: y } })}
                  className={`size-4 rounded-sm border cursor-pointer ${
                    Math.abs(wm.offsetX - x) < 0.1 && Math.abs(wm.offsetY - y) < 0.1
                      ? "border-accent bg-accent"
                      : "border-border bg-bg-secondary hover:border-accent"
                  }`}
                  aria-label={`position ${i}`}
                />
              ))}
            </div>
            <Range label={t("studio.overlayScale")} min={0.05} max={1} step={0.05} value={wm.scale}
              onChange={(scale) => setSpec({ watermark: { ...wm, scale } })} />
            <Range label={t("studio.watermarkOpacity")} min={0.1} max={1} step={0.05} value={wm.opacity}
              onChange={(opacity) => setSpec({ watermark: { ...wm, opacity } })} />
            <Range label={t("studio.offsetX")} min={-1} max={1} step={0.02} value={wm.offsetX}
              onChange={(offsetX) => setSpec({ watermark: { ...wm, offsetX } })} />
            <Range label={t("studio.offsetY")} min={-1} max={1} step={0.02} value={wm.offsetY}
              onChange={(offsetY) => setSpec({ watermark: { ...wm, offsetY } })} />
          </>
        )}
      </Section>
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
  const digits = step < 0.1 ? 2 : step < 1 ? 1 : 0;
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
      <NumberBox value={value} min={min} max={max} step={step} digits={digits} onChange={onChange} />
    </label>
  );
}

/** Editable readout: commits on Enter/blur, Esc reverts, arrows nudge. */
function NumberBox({ value, min, max, step, digits, onChange }: { value: number; min: number; max: number; step: number; digits: number; onChange: (v: number) => void }) {
  const shown = value.toFixed(digits);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft.replace(",", "."));
    setDraft(null);
    if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft ?? shown}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setDraft(null);
        else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const d = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
          setDraft(null);
          onChange(Math.min(max, Math.max(min, Number((value + d).toFixed(6)))));
        }
      }}
      className="w-12 rounded border border-transparent bg-transparent px-1 text-right tabular-nums text-text hover:border-border focus:border-accent focus:outline-none"
    />
  );
}

export function Section({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">{title}</h3>
      <div className={cn("flex flex-col gap-3", className)}>{children}</div>
    </section>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-3 text-xs text-text-secondary">
      <span className="w-16 shrink-0">{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)}
        className="h-7 w-12 cursor-pointer rounded border border-border bg-transparent" />
      <span className="tabular-nums text-text">{value}</span>
    </label>
  );
}
