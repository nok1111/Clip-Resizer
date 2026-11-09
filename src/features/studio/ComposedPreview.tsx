import { useEffect, useMemo, useRef, useState } from "react";
import { FastForward, Maximize, Pause, Play, Rewind, Volume2, VolumeX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import { ipc, videoUrl } from "@/lib/ipc";
import { specCanvas, specFrameCtx, useStudioStore, type StudioItem } from "@/stores/studio";
import { constrain, foldLegacy, placement, snap, type Snap } from "@/lib/framing";
import type { FitSpec } from "@/lib/ipc";

const SNAP_PX = 8;

/** CSS for a PiP/watermark box matching ffmpeg `overlay=(W-w)*px:(H-h)*py`. */
function cornerPlace(scale: number, ox: number, oy: number) {
  const px = (1 + Math.max(-1, Math.min(1, ox))) / 2;
  const py = (1 + Math.max(-1, Math.min(1, oy))) / 2;
  return {
    width: `${scale * 100}%`,
    left: `${px * 100}%`,
    top: `${py * 100}%`,
    transform: `translate(${-px * 100}%,${-py * 100}%)`,
  };
}

/** Drag delta → new -1..1 offset; the free span is measured, not guessed. */
function dragOffset(start: number, deltaPx: number, stagePx: number, elPx: number, cur: number) {
  const free = (stagePx - elPx) / stagePx;
  if (free < 0.01) return cur;
  return Math.max(-1, Math.min(1, start + (2 * deltaPx) / stagePx / free));
}

/**
 * CSS composition that mirrors the FFmpeg filtergraph 1:1 — canvas-ratio
 * stage; Fill = cover + pan/zoom, Fit = letterbox (solid or blurred copy).
 */
export function ComposedPreview({ item, onError }: { item: StudioItem; onError: () => void }) {
  const { t } = useTranslation();
  const spec = useStudioStore((s) => s.spec);
  const canvas = specCanvas(spec);
  const [time, setTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [dur, setDur] = useState(0);
  const fmtT = (v: number) => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, "0")}`;
  const skip = (d: number) => { const el = videoRef.current; if (el) el.currentTime += d; };
  const togglePlay = () => { const el = videoRef.current; if (!el) return; if (el.paused) void el.play(); else el.pause(); };
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
  const rot = ((spec.rotate % 360) + 360) % 360;
  const rotSwap = rot === 90 || rot === 270;
  const effW = rotSwap ? meta.height : meta.width;
  const effH = rotSwap ? meta.width : meta.height;
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; fit: FitSpec } | null>(null);
  const ovDrag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const wmDrag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const setSpec = useStudioStore((s) => s.setSpec);
  const resetFraming = useStudioStore((s) => s.resetFraming);
  const [guides, setGuides] = useState<Pick<Snap, "x" | "y"> | null>(null);
  const [stageW, setStageW] = useState(0);
  const ctx = useMemo(() => specFrameCtx(spec, meta), [spec, meta]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageW(el.clientWidth));
    ro.observe(el);
    // Wheel zoom centred on the cursor. Native listener: React's is passive
    // and could not stop the page from scrolling.
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("[data-no-wheel]")) return;
      e.preventDefault();
      const st = useStudioStore.getState();
      const cv = specCanvas(st.spec);
      const r2 = el.getBoundingClientRect();
      const anchor = {
        x: ((e.clientX - r2.left) / r2.width) * cv.width,
        y: ((e.clientY - r2.top) / r2.height) * cv.height,
      };
      const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      st.zoomTo(st.spec.fit.zoom * k, anchor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  const layers = useMemo(() => {
    const cover = Math.max(canvas.width / effW, canvas.height / effH);
    const vidRatio = `${meta.width} / ${meta.height}`;
    const mirror = `rotate(${rot}deg) scaleX(${spec.flip ? -1 : 1})`;
    // Same placement the export uses (Rust `placement`). The element keeps
    // the video's own aspect (width + aspect-ratio) and is rotated around
    // its centre, so only the centre and the unrotated width matter.
    const p = placement(spec.fit, ctx);
    const borderPx = stageW > 0 ? (p.border * stageW) / canvas.width : 0;
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
              transform: `translate(-50%,-50%) ${mirror} scale(1.1)`,
            }
          : null,
      imageUrl:
        spec.background.kind === "image" && spec.background.path
          ? convertFileSrc(spec.background.path)
          : null,
      imageBlur: spec.background.kind === "image" ? spec.background.blur / 2 : 0,
      fg: {
        width: `${(meta.width * p.scale * 100) / canvas.width}%`,
        aspectRatio: vidRatio,
        height: "auto",
        left: `${((p.x + p.w / 2) * 100) / canvas.width}%`,
        top: `${((p.y + p.h / 2) * 100) / canvas.height}%`,
        transform: `translate(-50%,-50%) ${mirror}`,
        boxSizing: "content-box" as const,
        border: borderPx > 0 ? `${borderPx}px solid ${spec.border[1]}` : undefined,
      },
      solid: spec.background.kind === "solid" ? spec.background.color : undefined,
    };
  }, [spec, canvas, meta, effW, effH, rot, ctx, stageW]);

  const endDrag = () => {
    drag.current = null;
    setGuides(null);
  };

  return (
    <div className="flex size-full flex-col">
      <div
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4"
        style={{ containerType: "size" }}
      >
        <div
          ref={stageRef}
          className="relative cursor-grab active:cursor-grabbing touch-none"
          title={t("studio.framingHint")}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            drag.current = { x: e.clientX, y: e.clientY, fit: foldLegacy(spec.fit, ctx) };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            const el = stageRef.current;
            if (!d || !el) return;
            const r2 = el.getBoundingClientRect();
            // Pan is a canvas fraction: the fg follows the pointer 1:1 at any
            // zoom, and can be pushed partially off-canvas when zoomed out.
            let fit = constrain(
              {
                ...d.fit,
                pan_x: d.fit.pan_x + (e.clientX - d.x) / r2.width,
                pan_y: d.fit.pan_y + (e.clientY - d.y) / r2.height,
              },
              ctx,
            );
            if (e.altKey) {
              setGuides(null);
            } else {
              const s = snap(fit, ctx, (SNAP_PX * canvas.width) / r2.width);
              fit = constrain(s.fit, ctx);
              setGuides(s.x === null && s.y === null ? null : { x: s.x, y: s.y });
            }
            setSpec({ fit });
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={resetFraming}
          style={{
            aspectRatio: `${canvas.width} / ${canvas.height}`,
            // cqw/cqh keep the canvas inside BOTH bounds without ever
            // breaking its aspect-ratio (maxWidth alone could squash it).
            height: r >= 1 ? "auto" : `min(100%, ${(100 * canvas.height) / canvas.width}cqw)`,
            width: r >= 1 ? `min(100%, ${(100 * canvas.width) / canvas.height}cqh)` : "auto",
          }}
        >
          {/* Clipped group: everything that lives inside the frame. */}
          <div
            className="absolute inset-0 overflow-hidden rounded-md shadow-card"
            style={{ background: layers.solid ?? "#000" }}
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
          </div>
          {/* The fg may bleed past the canvas edge — the outline below marks
              the actual output frame so the crop boundary stays clear. */}
          <video
            key={`fg-${item.path}`}
            src={effectiveSrc}
            controls={false}
            playsInline
            autoPlay
            loop
            muted={muted}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onLoadedMetadata={(e) => { setDur(e.currentTarget.duration); e.currentTarget.volume = volume; }}
            className="absolute object-fill"
            style={layers.fg}
            onError={handleError}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            ref={videoRef}
          />
          {/* PiP overlay — clipped to the frame but above the fg; draggable. */}
          {spec.overlay?.path && (
            <div className="absolute inset-0 overflow-hidden">
              <video
                key={`ov-${spec.overlay.path}`}
                src={convertFileSrc(spec.overlay.path)}
                muted
                playsInline
                autoPlay
                loop
                className="absolute cursor-move touch-none object-contain"
                style={cornerPlace(spec.overlay.scale, spec.overlay.offsetX, spec.overlay.offsetY)}
                onDoubleClick={(e) => e.stopPropagation()}
                onError={() => undefined}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  ovDrag.current = { x: e.clientX, y: e.clientY, ox: spec.overlay!.offsetX, oy: spec.overlay!.offsetY };
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const d = ovDrag.current;
                  const el = stageRef.current;
                  const ov = spec.overlay;
                  if (!d || !el || !ov) return;
                  const r2 = el.getBoundingClientRect();
                  const me = e.currentTarget.getBoundingClientRect();
                  e.stopPropagation();
                  setSpec({
                    overlay: {
                      ...ov,
                      offsetX: dragOffset(d.ox, e.clientX - d.x, r2.width, me.width, ov.offsetX),
                      offsetY: dragOffset(d.oy, e.clientY - d.y, r2.height, me.height, ov.offsetY),
                    },
                  });
                }}
                onPointerUp={() => (ovDrag.current = null)}
                onPointerCancel={() => (ovDrag.current = null)}
              />
            </div>
          )}
          {/* Watermark — topmost, clipped to the frame, draggable. */}
          {spec.watermark?.path && (
            <div className="absolute inset-0 overflow-hidden">
              <img
                src={convertFileSrc(spec.watermark.path)}
                alt=""
                draggable={false}
                className="absolute cursor-move touch-none object-contain"
                style={{
                  ...cornerPlace(spec.watermark.scale, spec.watermark.offsetX, spec.watermark.offsetY),
                  opacity: spec.watermark.opacity,
                }}
                onDoubleClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  wmDrag.current = { x: e.clientX, y: e.clientY, ox: spec.watermark!.offsetX, oy: spec.watermark!.offsetY };
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const d = wmDrag.current;
                  const el = stageRef.current;
                  const w = spec.watermark;
                  if (!d || !el || !w) return;
                  const r2 = el.getBoundingClientRect();
                  const me = e.currentTarget.getBoundingClientRect();
                  e.stopPropagation();
                  setSpec({
                    watermark: {
                      ...w,
                      offsetX: dragOffset(d.ox, e.clientX - d.x, r2.width, me.width, w.offsetX),
                      offsetY: dragOffset(d.oy, e.clientY - d.y, r2.height, me.height, w.offsetY),
                    },
                  });
                }}
                onPointerUp={() => (wmDrag.current = null)}
                onPointerCancel={() => (wmDrag.current = null)}
              />
            </div>
          )}
          {/* Snap guides while dragging the frame. */}
          {guides && (
            <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${canvas.width} ${canvas.height}`} preserveAspectRatio="none">
              {guides.x !== null && (
                <line x1={guides.x} y1={0} x2={guides.x} y2={canvas.height} stroke="rgb(56,189,248)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              )}
              {guides.y !== null && (
                <line x1={0} y1={guides.y} x2={canvas.width} y2={guides.y} stroke="rgb(56,189,248)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              )}
            </svg>
          )}
          {/* Canvas boundary — always visible above the bleeding fg. */}
          <div className="pointer-events-none absolute inset-0 rounded-md ring-1 ring-inset ring-white/50" />
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
          {/* Centered play affordance — circle is decorative; click resumes. */}
          {!playing && (
            <button
              type="button"
              onClick={togglePlay}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              className="absolute inset-0 z-20 flex items-center justify-center cursor-pointer"
              aria-label={t("player.play")}
            >
              <span className="pointer-events-none flex size-16 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm">
                <Play className="ml-1 size-7 fill-white text-white" />
              </span>
            </button>
          )}
          {/* Player bar — floats over the video bottom. */}
          <div
            className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-1.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pb-2 pt-8"
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            data-no-wheel
          >
            <button type="button" title={t("player.back")} onClick={() => skip(-10)}
              className="rounded p-1 text-white/80 hover:text-white cursor-pointer"><Rewind size={15} /></button>
            <button type="button" title={playing ? t("player.pause") : t("player.play")} onClick={togglePlay}
              className="rounded p-1 text-white hover:text-white cursor-pointer">
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button type="button" title={t("player.fwd")} onClick={() => skip(10)}
              className="rounded p-1 text-white/80 hover:text-white cursor-pointer"><FastForward size={15} /></button>
            <input
              type="range" min={0} max={dur || meta.durationMs / 1000} step={0.1} value={time}
              onChange={(e) => {
                const v = Number(e.target.value);
                const el = videoRef.current;
                if (el) el.currentTime = v;
                setTime(v);
              }}
              className="h-1.5 flex-1 cursor-pointer accent-accent"
              aria-label="timeline"
            />
            <span className="text-[11px] tabular-nums text-white/80">{fmtT(time)} / {fmtT(dur)}</span>
            <button type="button" title={muted ? t("player.unmute") : t("player.mute")}
              onClick={() => { const m = !muted; setMuted(m); const el = videoRef.current; if (el) el.muted = m; }}
              className="rounded p-1 text-white/80 hover:text-white cursor-pointer">
              {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <input
              type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume}
              title={t("player.volume")}
              onChange={(e) => { const v = Number(e.target.value); setVolume(v); setMuted(v === 0); const el = videoRef.current; if (el) { el.volume = v; el.muted = v === 0; } }}
              className="w-14 accent-accent"
            />
            <button
              type="button"
              onClick={() => { const next = !verify; setVerify(next); if (next) void verifyFrame(time); }}
              className="rounded px-1.5 py-0.5 text-[11px] text-white/80 hover:text-white cursor-pointer"
            >
              {verify ? "live" : "verify"}
            </button>
            <button type="button" title="fullscreen"
              onClick={() => { const el = stageRef.current; if (el?.requestFullscreen) void el.requestFullscreen(); }}
              className="rounded p-1 text-white/80 hover:text-white cursor-pointer"><Maximize size={15} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
