import { useMemo, useState } from "react";
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
      fg: {
        width: `${wPct}%`,
        height: `${hPct}%`,
        left: "50%",
        top: "50%",
        transform: "translate(-50%,-50%)",
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
