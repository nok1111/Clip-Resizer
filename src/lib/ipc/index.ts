import { invoke, Channel, convertFileSrc } from "@tauri-apps/api/core";
import type { AppInfo } from "./bindings/AppInfo";
import type { ProbeResult } from "./bindings/ProbeResult";
import type { ScanResult } from "./bindings/ScanResult";
import type { Settings } from "./bindings/Settings";
import type { ThumbInfo } from "./bindings/ThumbInfo";
import type { ConflictPolicy } from "./bindings/ConflictPolicy";
import type { RenderEvent } from "./bindings/RenderEvent";
import type { RenderSpec } from "./bindings/RenderSpec";
import type { VideoCodec } from "./bindings/VideoCodec";
import type { QueueEvent } from "./bindings/QueueEvent";
import type { QueueItem } from "./bindings/QueueItem";
import type { HistoryRow } from "./bindings/HistoryRow";
import type { LicenseStatus } from "./bindings/LicenseStatus";

export type { AppInfo } from "./bindings/AppInfo";
export type { Language } from "./bindings/Language";
export type { OverlaySpec } from "./bindings/OverlaySpec";
export type { WatermarkSpec } from "./bindings/WatermarkSpec";
export type { LocalVideo } from "./bindings/LocalVideo";
export type { ProbeError } from "./bindings/ProbeError";
export type { LicenseStatus } from "./bindings/LicenseStatus";
export type { ProbeResult } from "./bindings/ProbeResult";
export type { RejectedFile } from "./bindings/RejectedFile";
export type { RejectReason } from "./bindings/RejectReason";
export type { ScanResult } from "./bindings/ScanResult";
export type { Settings } from "./bindings/Settings";
export type { Theme } from "./bindings/Theme";
export type { ThumbInfo } from "./bindings/ThumbInfo";
export type { VideoMeta } from "./bindings/VideoMeta";
export type { AspectPreset } from "./bindings/AspectPreset";
export type { AudioMode } from "./bindings/AudioMode";
export type { Background } from "./bindings/Background";
export type { Canvas } from "./bindings/Canvas";
export type { ConflictPolicy } from "./bindings/ConflictPolicy";
export type { ExportSpec } from "./bindings/ExportSpec";
export type { FitSpec } from "./bindings/FitSpec";
export type { QualityPreset } from "./bindings/QualityPreset";
export type { RenderEvent } from "./bindings/RenderEvent";
export type { RenderSpec } from "./bindings/RenderSpec";
export type { VideoCodec } from "./bindings/VideoCodec";
export type { QueueEvent } from "./bindings/QueueEvent";
export type { QueueItem } from "./bindings/QueueItem";
export type { QueueStatus } from "./bindings/QueueStatus";
export type { HistoryRow } from "./bindings/HistoryRow";
export type { Guides } from "./bindings/Guides";

/** Shape of errors returned by Rust commands (see src-tauri/src/error.rs). */
export interface CommandError {
  code: string;
  message: string;
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as CommandError).message);
  return String(e);
}

export function errorCode(e: unknown): string | null {
  if (e && typeof e === "object" && "code" in e) return String((e as CommandError).code);
  return null;
}

/** Local video URL for <video>: asset:// (Range + secure-scheme handling). */
export function videoUrl(path: string): string {
  return convertFileSrc(path);
}

export const ipc = {
  appInfo: () => invoke<AppInfo>("app_info"),
  openOutputDir: () => invoke<void>("open_output_dir"),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  resetSettings: () => invoke<Settings>("reset_settings"),
  scanInputs: (paths: string[]) => invoke<ScanResult>("scan_inputs", { paths }),
  probeVideos: (paths: string[]) => invoke<ProbeResult[]>("probe_videos", { paths }),
  videoThumbnail: (path: string, seekS?: number | null, target?: number | null) =>
    invoke<ThumbInfo>("video_thumbnail", {
      path,
      seekS: seekS ?? null,
      target: target ?? null,
    }),
  revealPath: (path: string) => invoke<void>("reveal_path", { path }),
  pickOutputDir: () => invoke<string | null>("pick_output_dir"),
  listEncoders: () => invoke<string[]>("list_encoders"),
  resolveEncoder: (codec: VideoCodec) => invoke<string | null>("resolve_encoder", { codec }),
  previewFrame: (spec: RenderSpec, tS: number) =>
    invoke<ThumbInfo>("preview_frame", { spec, tS }),
  startRender: (spec: RenderSpec, outputDir: string, conflict: ConflictPolicy, onEvent: (e: RenderEvent) => void) => {
    const channel = new Channel<RenderEvent>();
    channel.onmessage = onEvent;
    return invoke<void>("start_render", { spec, outputDir, conflict, onEvent: channel });
  },
  cancelRender: () => invoke<boolean>("cancel_render"),
  previewProxy: (path: string) => invoke<string>("preview_proxy", { path }),
  enqueueRender: (specs: RenderSpec[], outputDir: string, conflict: ConflictPolicy, onEvent: (e: QueueEvent) => void) => {
    const channel = new Channel<QueueEvent>();
    channel.onmessage = onEvent;
    return invoke<number[]>("enqueue_render", { specs, outputDir, conflict, onEvent: channel });
  },
  queueItems: () => invoke<QueueItem[]>("queue_items"),
  queueCancel: (id: number) => invoke<boolean>("queue_cancel", { id }),
  queueRetry: (id: number) => invoke<boolean>("queue_retry", { id }),
  queueRemove: (id: number) => invoke<boolean>("queue_remove", { id }),
  renderHistory: () => invoke<HistoryRow[]>("render_history"),
  edition: () => invoke<"free" | "pro">("edition"),
  licenseStatus: () => invoke<LicenseStatus>("license_status"),
  licenseActivate: (key: string) => invoke<LicenseStatus>("license_activate", { key }),
  licenseDeactivate: () => invoke<LicenseStatus>("license_deactivate"),
  savePreset: (name: string, spec: string) => invoke<number>("save_preset", { name, spec }),
  listPresets: () => invoke<[string, string][]>("list_presets"),
  deletePreset: (name: string) => invoke<boolean>("delete_preset", { name }),
};
