import { describe, it, expect } from "vitest";
import {
  parseStamp,
  absoluteStamp,
  relativeAge,
  timestampTitle,
} from "../../src/core/utils/relativeTime.js";

/** A fixed "now" so every case is deterministic. */
// Exercises the core module directly; the frontend re-exports these verbatim.
const NOW = new Date("2026-08-11T23:00:00").getTime();
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

describe("parseStamp", () => {
  it("accepts epoch ms, ISO, and the audit log's space-separated form", () => {
    expect(parseStamp(NOW)?.getTime()).toBe(NOW);
    expect(parseStamp("2026-08-11T23:00:00")?.getTime()).toBe(NOW);
    // The audit API emits this shape; it is not ISO-8601 and Safari rejects
    // it outright, which is why it is normalised before parsing.
    expect(parseStamp("2026-08-11 23:00:00")?.getTime()).toBe(NOW);
  });

  it("returns null for junk rather than an Invalid Date", () => {
    expect(parseStamp("not a date")).toBeNull();
    expect(parseStamp("")).toBeNull();
    expect(parseStamp(Number.NaN)).toBeNull();
  });
});

describe("absoluteStamp", () => {
  it("formats locale-independently, so the UI language sets the format", () => {
    // The bug this replaces: toLocaleString(undefined, …) rendered
    // "11. Aug., 23:00" for a German browser inside an English dashboard.
    expect(absoluteStamp(NOW)).toBe("2026-08-11 23:00");
    expect(absoluteStamp(NOW, true)).toBe("2026-08-11 23:00:00");
  });

  it("echoes an unparseable string instead of inventing a date", () => {
    expect(absoluteStamp("whenever")).toBe("whenever");
  });
});

describe("relativeAge", () => {
  it("escalates each unit at its own boundary", () => {
    expect(relativeAge(NOW - 10_000, NOW)).toBe("just now");
    expect(relativeAge(NOW - 12 * MINUTE, NOW)).toBe("12 min ago");
    expect(relativeAge(NOW - 3 * HOUR, NOW)).toBe("3 h ago");
    expect(relativeAge(NOW - 25 * HOUR, NOW)).toBe("1 day ago");
    expect(relativeAge(NOW - 3 * DAY, NOW)).toBe("3 days ago");
  });

  it("does not count past 24 hours in hours", () => {
    // Regression: the backups table printed "48 h ago" one row above
    // "3 days ago" for archives one day apart.
    expect(relativeAge(NOW - 2 * DAY, NOW)).toBe("2 days ago");
    expect(relativeAge(NOW - 47 * HOUR, NOW)).not.toContain("h ago");
  });

  it("falls back to an absolute stamp once relative stops helping", () => {
    expect(relativeAge(NOW - 30 * DAY, NOW)).toBe("2026-07-12 23:00");
  });

  it("treats a future stamp as clock skew, not a negative age", () => {
    expect(relativeAge(NOW + 5 * MINUTE, NOW)).toBe("just now");
  });
});

describe("timestampTitle", () => {
  it("always carries seconds, so the relative label hides nothing", () => {
    expect(timestampTitle(NOW - 90 * MINUTE)).toBe("2026-08-11 21:30:00");
  });
});
