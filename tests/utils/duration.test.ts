import { describe, it, expect } from "vitest";
import {
  parseDuration,
  formatDuration,
  MS,
  MAX_DURATION_MS,
} from "../../src/core/utils/duration.js";

describe("parseDuration", () => {
  it("parses each unit", () => {
    expect(parseDuration("45s")).toBe(45 * MS.second);
    expect(parseDuration("1m")).toBe(MS.minute);
    expect(parseDuration("2h")).toBe(2 * MS.hour);
    expect(parseDuration("3d")).toBe(3 * MS.day);
    expect(parseDuration("1w")).toBe(MS.week);
    expect(parseDuration("2mo")).toBe(2 * MS.month);
    expect(parseDuration("1y")).toBe(MS.year);
  });

  it("reads 'mo' as months, not minutes", () => {
    expect(parseDuration("2mo")).toBeGreaterThan(parseDuration("2m")!);
  });

  it("accepts fractional amounts", () => {
    expect(parseDuration("1.5y")).toBe(Math.round(1.5 * MS.year));
    expect(parseDuration("0.5h")).toBe(30 * MS.minute);
  });

  it("sums concatenated segments and ignores spacing/case", () => {
    expect(parseDuration("1d12h")).toBe(MS.day + 12 * MS.hour);
    expect(parseDuration(" 2H 30M ")).toBe(2 * MS.hour + 30 * MS.minute);
  });

  it("rejects junk rather than parsing part of it", () => {
    for (const input of ["", "forever", "2h then some", "h", "5", "2x", "-3d"]) {
      expect(parseDuration(input)).toBeNull();
    }
  });

  it("rejects durations outside the supported range", () => {
    expect(parseDuration("100y")).toBeNull();
    expect(parseDuration("0s")).toBeNull();
    expect(parseDuration("10y")).toBe(MAX_DURATION_MS);
  });
});

describe("formatDuration", () => {
  it("shows the two largest non-zero units", () => {
    expect(formatDuration(2 * MS.day + 4 * MS.hour + 30 * MS.minute)).toBe(
      "2d 4h",
    );
    expect(formatDuration(45 * MS.minute)).toBe("45m");
    expect(formatDuration(MS.hour)).toBe("1h");
  });

  it("floors sub-second spans to 0s", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(500)).toBe("0s");
  });

  it("round-trips a parsed duration back to the same wording", () => {
    expect(formatDuration(parseDuration("3d")!)).toBe("3d");
  });
});
