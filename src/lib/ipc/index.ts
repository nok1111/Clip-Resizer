import { invoke } from "@tauri-apps/api/core";
import type { AppInfo } from "./bindings/AppInfo";
import type { ProbeResult } from "./bindings/ProbeResult";
import type { ScanResult } from "./bindings/ScanResult";
import type { Settings } from "./bindings/Settings";
import type { ThumbInfo } from "./bindings/ThumbInfo";

export type { AppInfo } from "./bindings/AppInfo";
export type { Language } from "./bindings/Language";
export type { LocalVideo } from "./bindings/LocalVideo";
export type { ProbeError } from "./bindings/ProbeError";
export type { ProbeResult } from "./bindings/ProbeResult";
export type { RejectedFile } from "./bindings/RejectedFile";
export type { RejectReason } from "./bindings/RejectReason";
export type { ScanResult } from "./bindings/ScanResult";
export type { Settings } from "./bindings/Settings";
export type { Theme } from "./bindings/Theme";
export type { ThumbInfo } from "./bindings/ThumbInfo";
export type { VideoMeta } from "./bindings/VideoMeta";

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

/** clipvid:// URL for a whitelisted video (percent-encoded full path). */
export function videoUrl(path: string): string {
  return `clipvid://localhost/${encodeURIComponent(path)}`;
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
};
