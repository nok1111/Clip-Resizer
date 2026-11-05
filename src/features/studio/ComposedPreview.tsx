import { useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { videoUrl } from "@/lib/ipc";
import { specCanvas, useStudioStore, type StudioItem } from "@/stores/studio";

/**
 * CSS composition that mirrors the FFmpeg filtergraph 1:1 — canvas-ratio
 * stage; Fill = cover + pan/zoom, Fit = letterbox (solid or blurred copy).
 */
export function ComposedPreview({ item, onError }: { item: StudioItem; onError: () => void }) {
  const spec = useStudioStore((s) => s.spec);
  const canvas = specCanvas(spec);
  const [time, setTime] = useState(0);
  const [verify, setVerify] = useState(false);
  const previewFrameUrl = useStudioStore((s) => s.previewFrameUrl);
  const verifyFrame = useStudioStore((s) => s.verifyFrame);

  const meta = item.meta!;
  const r = canvas.width / canvas.height;

  const layers = useMemo(() => {
    const cover = Math.max(canvas.width / meta.width, canvas.height / meta.height);
    const fit = Math.min(canvas.width / meta.width, canvas.height / meta.height);
    if (spec.fit.kind === "fill") {
      const sc = cover * spec.fit.zoom;
      const wPct = (meta.width * sc * 100) / canvas.width;
      const hPct = (meta.height * sc * 100) / canvas.height;
      const slackX = Math.max(0, (wPct - 100) / 2);
      const slackY = Math.max(0, (hPct - 100) / 2);
      return {
        bg: null,
        fg: {
          width: `${wPct}%`,
          height: `${hPct}%`,
          left: `${50 + spec.fit.offset_x * slackX}%`,
          top: `${50 + spec.fit.offset_y * slackY}%`,
          transform: "translate(-50%,-50%)",
        },
      };
    }
    const wPct = (meta.width * fit * 100) / canvas.width;
    const hPct = (meta.height * fit * 100) / canvas.height;
    // margin shrinks the fg box relative to the canvas (mirrors filtergraph).
    const shrink = 1 - 2 * spec.margin;
    const bPx = (spec.border[0] / canvas.height) * 100;
    return {
      bg:
        spec.background.kind === "blur"
          ? {
              width: `${(meta.width * cover * 100) / canvas.width}%`,
              height: `${(meta.height * cover * 100) / canvas.height}%`,
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
        height: `${hPct * shrink}%`,
        left: "50%",
        top: "50%",
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
              src={videoUrl(item.path)}
              muted
              playsInline
              autoPlay
              loop
              className="absolute object-cover"
              style={layers.bg}
              onError={onError}
            />
          )}
          <video
            key={`fg-${item.path}`}
            src={videoUrl(item.path)}
            controls={false}
            playsInline
            autoPlay
            loop
            muted={layers.bg != null}
            className="absolute object-fill"
            style={layers.fg}
            onError={onError}
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
