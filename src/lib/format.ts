export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function formatDurationMs(ms: number): string {
  return formatDuration(Math.max(0, Math.round(ms / 1000)));
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number): string {
  let v = Math.max(0, bytes);
  let u = 0;
  while (v >= 1024 && u < UNITS.length - 1) {
    v /= 1024;
    u++;
  }
  return `${u === 0 ? v : v.toFixed(v < 10 ? 1 : 0)} ${UNITS[u]}`;
}

/** "29.97" | "30" — trims pointless decimals, "—" for unknown. */
export function formatFps(fps: number): string {
  if (!fps || fps <= 0) return "—";
  return fps >= 100 ? fps.toFixed(0) : Number(fps.toFixed(2)).toString();
}

/** "16:9"-style aspect label from pixel dimensions, "—" for unknown. */
export function aspectLabel(width: number, height: number): string {
  if (!width || !height) return "—";
  const g = gcd(width, height);
  const w = width / g;
  const h = height / g;
  // Near-standard ratios get their friendly name even with odd pixels.
  const r = width / height;
  for (const [aw, ah] of [
    [16, 9],
    [9, 16],
    [1, 1],
    [4, 5],
    [4, 3],
    [3, 4],
    [21, 9],
  ] as const) {
    if (Math.abs(r - aw / ah) < 0.02) return `${aw}:${ah}`;
  }
  return `${w}:${h}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
