import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ipc, videoUrl } from "@/lib/ipc";
import { specCanvas, useStudioStore, type StudioItem } from "@/stores/studio";

/**
 * CSS composition that mirrors the FFmpeg filtergraph 1:1 — canvas-ratio
 * stage; Fill = cover + pan/zoom, Fit = letterbox (solid or blurred copy).
 */
export function ComposedPreview({ item, onError }: { item: StudioItem; onError: () => void }) {
  const { t } = useTranslation();
  const spec = useStudioStore((s) => s.spec);
  const canvas = specCanvas(spec);
  const [time, setTime] = useState(0);
  const [verify, setVerify] = useState(false);
  const previewFrameUrl = useStudioStore((s) => s.previewFrameUrl);
  const verifyFrame = useStudioStore((s) => s.verifyFrame);
  // Decodable formats play directly; otherwise we transcode once to a
  // cached H.264 proxy and swap the source.
  const [src, setSrc] = useState<string | null>(null);
  const [proxying, setProxying] = useState(false);
  const triedProxy = useRef<string | null>(null);
  const effectiveSrc = src ?? videoUrl(item.path);
  const handleError = () => {
    if (triedProxy.current !== item.path && !proxying) {
      triedProxy.current = item.path;
      setProxying(true);
      ipc
        .previewProxy(item.path)
        .then((p) => setSrc(p === item.path ? videoUrl(p) : convertFileSrc(p)))
        .catch(() => onError())
        .finally(() => setProxying(false));
    } else {
      onError();
    }
  };

  const meta = item.meta!;
  const r = canvas.width / canvas.height;

  const layers = useMemo(() => {
    const cover = Math.max(canvas.width / meta.width, canvas.height / meta.height);
    const fit = Math.min(canvas.width / meta.width, canvas.height / meta.height);
    const vidRatio = `${meta.width} / ${meta.height}`;
    // Position/sizing helper: element keeps the video's own aspect (width
    // + aspect-ratio, never independent w/h → no distortion is possible).
    const box = (scale: number) => {
      const wPct = (meta.width * scale * 100) / canvas.width;
      const hPct = (meta.height * scale * 100) / canvas.height;
      return { wPct, hPct };
    };
    if (spec.fit.kind === "fill" && spec.fit.zoom >= 0.999) {
      const { wPct, hPct } = box(cover * spec.fit.zoom);
      const slackX = Math.max(0, (wPct - 100) / 2);
      const slackY = Math.max(0, (hPct - 100) / 2);
      return {
        bg: null,
        fg: {
          width: `${wPct}%`,
          aspectRatio: vidRatio,
          height: "auto",
          // Sign must match the FFmpeg crop: positive offset pans the
          // visible window toward the right/bottom of the source.
          left: `${50 - spec.fit.offset_x * slackX}%`,
          top: `${50 - spec.fit.offset_y * slackY}%`,
          transform: "translate(-50%,-50%)",
        },
      };
    }
    // Fit, or zoomed-out Fill (zoom < 1): fg sits on the chosen background.
    const fgScale =
      spec.fit.kind === "fill" ? cover * spec.fit.zoom : fit * spec.fit.zoom;
    const { wPct, hPct } = box(fgScale);
    const shrink = spec.fit.kind === "fill" ? 1 : 1 - 2 * spec.margin;
    // Pan within the free space (letterbox) or the crop window (oversized).
    const oxx = "offset_x" in spec.fit ? spec.fit.offset_x : 0;
    const oyy = "offset_y" in spec.fit ? spec.fit.offset_y : 0;
    const slackX = (wPct * shrink - 100) / 2;
    const slackY = (hPct * shrink - 100) / 2;
    const bPx = (spec.border[0] / canvas.height) * 100;
    return {
      bg:
        spec.background.kind === "blur"
          ? {
              width: `${(meta.width * cover * 100) / canvas.width}%`,
              aspectRatio: vidRatio,
              height: "auto",
              left: "50%",
              top: "50%",
              filter: `blur(${Math.round(spec.background.sigma / 2)}px) brightness(${1 - spec.background.dim})`,
              transform: "translate(-50%,-50%) scale(1.1)",
            }
          : null,
      imageUrl:
        spec.background.kind === "image" && spec.background.path
          ? convertFileSrc(spec.background.path)
          : null,
      imageBlur: spec.background.kind === "image" ? spec.background.blur / 2 : 0,
      fg: {
        width: `${wPct * shrink}%`,
        aspectRatio: vidRatio,
        height: "auto",
        left: `${50 - oxx * slackX}%`,
        top: `${50 - oyy * slackY}%`,
        transform: "translate(-50%,-50%)",
        boxSizing: "border-box" as const,
        border: spec.border[0] > 0 ? `${bPx}cqh solid ${spec.border[1]}` : undefined,
      },
      solid: spec.background.kind === "solid" ? spec.background.color : undefined,
    };
  }, [spec, canvas, meta]);

  return (
    <div className="flex size-full flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <div
          className="relative overflow-hidden rounded-md shadow-card"
          style={{
            aspectRatio: `${canvas.width} / ${canvas.height}`,
            height: r >= 1 ? "auto" : "100%",
            width: r >= 1 ? "100%" : "auto",
            maxWidth: "100%",
            maxHeight: "100%",
            background: layers.solid ?? "#000",
          }}
        >
          {layers.imageUrl && (
            <img
              src={layers.imageUrl}
              alt=""
              className="absolute size-full object-cover"
              style={{ filter: layers.imageBlur ? `blur(${layers.imageBlur}px)` : undefined }}
              draggable={false}
            />
          )}
          {layers.bg && (
            <video
              key={`bg-${item.path}`}
              src={effectiveSrc}
              muted
              playsInline
              autoPlay
              loop
              className="absolute object-cover"
              style={layers.bg}
              onError={handleError}
            />
          )}
          <video
            key={`fg-${item.path}`}
            src={effectiveSrc}
            controls={false}
            playsInline
            autoPlay
            loop
            muted={layers.bg != null}
            className="absolute object-fill"
            style={layers.fg}
            onError={handleError}
            ref={(el) => {
              if (!el) return;
              const id = setInterval(() => setTime(el.currentTime), 250);
              const obs = () => clearInterval(id);
              el.addEventListener("emptied", obs, { once: true });
            }}
          />
          {/* Guide overlays — preview only unless spec.guides.export */}
          {spec.guides.thirds && (
            <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 3 3" preserveAspectRatio="none">
              <line x1="1" y1="0" x2="1" y2="3" stroke="rgba(255,235,60,0.6)" strokeWidth="0.015" vectorEffect="non-scaling-stroke" />
              <line x1="2" y1="0" x2="2" y2="3" stroke="rgba(255,235,60,0.6)" strokeWidth="0.015" vectorEffect="non-scaling-stroke" />
              <line x1="0" y1="1" x2="3" y2="1" stroke="rgba(255,235,60,0.6)" strokeWidth="0.015" vectorEffect="non-scaling-stroke" />
              <line x1="0" y1="2" x2="3" y2="2" stroke="rgba(255,235,60,0.6)" strokeWidth="0.015" vectorEffect="non-scaling-stroke" />
            </svg>
          )}
          {spec.guides.safe && (
            <div className="pointer-events-none absolute border border-warning/70" style={{ inset: "5%" }} />
          )}
          {spec.guides.center && (
            <svg className="pointer-events-none absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <line x1="50" y1="46" x2="50" y2="54" stroke="rgba(255,235,60,0.7)" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
              <line x1="46" y1="50" x2="54" y2="50" stroke="rgba(255,235,60,0.7)" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
            </svg>
          )}
          {proxying && (
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/70 px-2 py-1 text-[11px] text-text-secondary">
              {t("studio.proxying")}
            </span>
          )}
          {verify && previewFrameUrl && (
            <img
              src={previewFrameUrl}
              alt=""
              className="absolute inset-0 size-full object-cover"
              draggable={false}
            />
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 px-4 pb-3">
        <input
          type="range"
          min={0}
          max={meta.durationMs / 1000}
          step={0.1}
          value={time}
          onChange={(e) => {
            const t = Number(e.target.value);
            setTime(t);
            document
              .querySelectorAll<HTMLVideoElement>("video")
              .forEach((v) => {
                v.currentTime = t;
                v.pause();
              });
          }}
          className="h-1.5 flex-1 cursor-pointer accent-[var(--cr-accent)]"
          aria-label="timeline"
        />
        <span className="text-xs tabular-nums text-text-secondary">
          {time.toFixed(1)}s
        </span>
        <button
          type="button"
          onClick={() => {
            const next = !verify;
            setVerify(next);
            if (next) void verifyFrame(time);
          }}
          className="rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-secondary hover:text-text cursor-pointer"
        >
          {verify ? "live" : "verify"}
        </button>
      </div>
    </div>
  );
}
