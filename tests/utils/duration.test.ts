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

describe("formatSpan", () => {
  it("renders the two largest adjacent units with spaces", async () => {
    const { formatSpan, MS } = await import("../../src/core/utils/duration.js");
    expect(formatSpan(2 * MS.day + 7 * MS.hour + 5 * MS.minute)).toBe("2 d 7 h");
    expect(formatSpan(4 * MS.minute + 18 * MS.second)).toBe("4 min 18 s");
    expect(formatSpan(2 * MS.day + 5 * MS.minute)).toBe("2 d");
    expect(formatSpan(500)).toBe("0 s");
    expect(formatSpan(Number.NaN)).toBe("0 s");
  });

  it("honours maxUnits and stops at the first gap", async () => {
    const { formatSpan, MS } = await import("../../src/core/utils/duration.js");
    expect(formatSpan(MS.day + MS.hour + MS.minute, 3)).toBe("1 d 1 h 1 min");
    expect(formatSpan(MS.day + MS.hour + MS.minute, 1)).toBe("1 d");
    expect(formatSpan(40 * MS.day)).toBe("40 d");
    expect(formatSpan(Infinity)).toBe("0 s");
  });
});

describe("shared unit table", () => {
  it("formatDuration keeps non-adjacent units, skips weeks, and prints year/month", async () => {
    const { formatDuration, MS } = await import("../../src/core/utils/duration.js");
    expect(formatDuration(2 * MS.day + 5 * MS.minute)).toBe("2d 5m");
    expect(formatDuration(8 * MS.day)).toBe("8d");
    expect(formatDuration(MS.year + MS.month + MS.day)).toBe("1y 1mo");
    expect(formatDuration(90 * MS.second)).toBe("1m 30s");
  });

  it("formatDuration guards non-finite input", async () => {
    const { formatDuration } = await import("../../src/core/utils/duration.js");
    expect(formatDuration(Number.NaN)).toBe("0s");
    expect(formatDuration(Infinity)).toBe("0s");
  });

  it("parses every suffix, including weeks, and tells mo from m", async () => {
    const { parseDuration, MS } = await import("../../src/core/utils/duration.js");
    expect(parseDuration("1w")).toBe(MS.week);
    expect(parseDuration("1mo")).toBe(MS.month);
    expect(parseDuration("1m")).toBe(MS.minute);
  });

  it("re-exports the schema MS table", async () => {
    const core = await import("../../src/core/utils/duration.js");
    const schema = await import("@mcbot/schema/time.js");
    expect(core.MS).toBe(schema.MS);
  });
});
