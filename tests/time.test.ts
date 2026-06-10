import { describe, it, expect } from "vitest";
import {
  formatDatetime,
  formatDate,
  formatTime,
  nextMidnightEpoch,
  msUntilMidnight,
  TZ,
} from "../src/utils/time.js";

describe("TZ constant", () => {
  it("is a non-empty string", () => {
    expect(typeof TZ).toBe("string");
    expect(TZ.length).toBeGreaterThan(0);
  });
});

describe("formatDatetime", () => {
  it("returns a string matching YYYY-MM-DD HH:MM:SS format", () => {
    const result = formatDatetime(new Date("2025-06-15T10:30:45Z"));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("accepts a numeric epoch timestamp", () => {
    const epoch = new Date("2025-01-01T12:00:00Z").getTime();
    const result = formatDatetime(epoch);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("uses current time when called with no arguments", () => {
    const result = formatDatetime();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("year part is a 4-digit number in reasonable range", () => {
    const result = formatDatetime(new Date("2025-03-20T08:00:00Z"));
    const year = parseInt(result.split("-")[0]!);
    expect(year).toBeGreaterThanOrEqual(2024);
    expect(year).toBeLessThanOrEqual(2030);
  });

  it("produces a different result for different input times", () => {
    const a = formatDatetime(new Date("2025-01-01T00:00:00Z"));
    const b = formatDatetime(new Date("2025-12-31T23:59:59Z"));
    expect(a).not.toBe(b);
  });
});

describe("formatDate", () => {
  it("returns only the date portion (YYYY-MM-DD)", () => {
    const result = formatDate(new Date("2025-06-15T10:30:45Z"));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("does not include time part", () => {
    const result = formatDate(new Date("2025-01-01T23:59:59Z"));
    expect(result.split(" ")).toHaveLength(1);
    expect(result).not.toContain(":");
  });

  it("accepts a numeric epoch", () => {
    const epoch = Date.now();
    const result = formatDate(epoch);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("uses current date when called with no arguments", () => {
    const result = formatDate();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("formatTime", () => {
  it("returns HH:MM format", () => {
    const result = formatTime(new Date("2025-06-15T14:30:00Z"));
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it("has exactly 5 characters", () => {
    const result = formatTime(new Date("2025-01-01T09:05:00Z"));
    expect(result).toHaveLength(5);
  });

  it("uses current time when called with no arguments", () => {
    const result = formatTime();
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it("accepts a numeric epoch", () => {
    const result = formatTime(Date.now());
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("nextMidnightEpoch", () => {
  it("returns a timestamp in the future", () => {
    const next = nextMidnightEpoch();
    expect(next).toBeGreaterThan(Date.now());
  });

  it("returns a timestamp at most 24 hours from now", () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const gap = nextMidnightEpoch() - Date.now();
    expect(gap).toBeLessThanOrEqual(DAY_MS);
  });

  it("returns a timestamp greater than 0", () => {
    expect(nextMidnightEpoch()).toBeGreaterThan(0);
  });

  it("is reproducible within a short window", () => {
    const a = nextMidnightEpoch();
    const b = nextMidnightEpoch();
    // Both calls are within 1 second of each other
    expect(Math.abs(a - b)).toBeLessThan(1000);
  });
});

describe("msUntilMidnight", () => {
  it("returns a positive number", () => {
    expect(msUntilMidnight()).toBeGreaterThan(0);
  });

  it("returns at most 24 hours worth of milliseconds", () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    expect(msUntilMidnight()).toBeLessThanOrEqual(DAY_MS);
  });

  it("is consistent with nextMidnightEpoch", () => {
    const ms = msUntilMidnight();
    const epoch = nextMidnightEpoch();
    const diff = Math.abs(epoch - Date.now() - ms);
    // Should differ by less than 100ms (timing jitter between two calls)
    expect(diff).toBeLessThan(100);
  });
});
