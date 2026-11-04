import { describe, expect, it } from "vitest";
import { aspectLabel, formatBytes, formatDuration, formatDurationMs, formatFps } from "./format";

describe("formatDuration", () => {
  it("formats m:ss under an hour and h:mm:ss above", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(3661)).toBe("1:01:01");
  });
  it("clamps negatives", () => expect(formatDuration(-5)).toBe("0:00"));
});

describe("formatDurationMs", () => {
  it("converts ms to seconds", () => expect(formatDurationMs(65400)).toBe("1:05"));
});

describe("formatBytes", () => {
  it("scales through units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("formatFps", () => {
  it("trims decimals and handles unknown", () => {
    expect(formatFps(30)).toBe("30");
    expect(formatFps(29.97)).toBe("29.97");
    expect(formatFps(0)).toBe("—");
  });
});

describe("aspectLabel", () => {
  it("detects standard ratios and reduces others", () => {
    expect(aspectLabel(1920, 1080)).toBe("16:9");
    expect(aspectLabel(1080, 1920)).toBe("9:16");
    expect(aspectLabel(1080, 1080)).toBe("1:1");
    expect(aspectLabel(1080, 1350)).toBe("4:5");
    expect(aspectLabel(0, 0)).toBe("—");
  });
});
