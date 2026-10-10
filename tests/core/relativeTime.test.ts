import { describe, it, expect } from "vitest";
import {
  parseStamp,
  absoluteStamp,
  relativeAge,
  timestampTitle,
} from "../../src/core/utils/relativeTime.js";

/** A fixed "now" so every case is deterministic. */
// Exercises the core module directly; the frontend re-exports these verbatim.
const NOW = Date.UTC(2026, 7, 11, 23, 0, 0);
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const pad = (n: number): string => String(n).padStart(2, "0");
/** What absoluteStamp should print for an instant in the runner's own zone. */
function localStamp(ms: number, seconds = false): string {
  const d = new Date(ms);
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return seconds ? `${base}:${pad(d.getSeconds())}` : base;
}

describe("parseStamp", () => {
  it("accepts epoch ms, ISO, and the audit log's space-separated form", () => {
    expect(parseStamp(NOW)?.getTime()).toBe(NOW);
    expect(parseStamp("2026-08-11T23:00:00Z")?.getTime()).toBe(NOW);
    // The audit API emits this shape; it is not ISO-8601 and Safari rejects
    // it outright, which is why it is normalised before parsing.
    expect(parseStamp("2026-08-11 23:00:00")?.getTime()).toBe(NOW);
  });

  it("reads the space-separated form as UTC in every timezone", () => {
    const utc = Date.UTC(2026, 7, 11, 23, 0, 0);
    expect(parseStamp("2026-08-11 23:00:00")?.getTime()).toBe(utc);
    expect(parseStamp("2026-08-11 23:00")?.getTime()).toBe(utc);
    expect(parseStamp("2026-08-11 23:00:00.250")?.getTime()).toBe(utc + 250);
  });

  it("keeps an explicit offset on the space-separated form", () => {
    expect(parseStamp("2026-08-11 23:00:00+02:00")?.getTime()).toBe(
      Date.UTC(2026, 7, 11, 21, 0, 0),
    );
  });

  it("returns null for junk rather than an Invalid Date", () => {
    expect(parseStamp("not a date")).toBeNull();
    expect(parseStamp("")).toBeNull();
    expect(parseStamp(Number.NaN)).toBeNull();
  });
});

describe("audit stamps against a UTC clock", () => {
  it("ages a just-written row as just now, whatever the zone offset", () => {
    const written = "2026-08-11 22:58:00";
    expect(relativeAge(written, NOW)).toBe("2 min ago");
  });
});

describe("absoluteStamp", () => {
  it("formats locale-independently, so the UI language sets the format", () => {
    // The bug this replaces: toLocaleString(undefined, …) rendered
    // "11. Aug., 23:00" for a German browser inside an English dashboard.
    expect(absoluteStamp(NOW)).toBe(localStamp(NOW));
    expect(absoluteStamp(NOW, true)).toBe(localStamp(NOW, true));
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
    expect(relativeAge(NOW - 30 * DAY, NOW)).toBe(localStamp(NOW - 30 * DAY));
  });

  it("treats a future stamp as clock skew, not a negative age", () => {
    expect(relativeAge(NOW + 5 * MINUTE, NOW)).toBe("just now");
  });
});

describe("timestampTitle", () => {
  it("always carries seconds, so the relative label hides nothing", () => {
    expect(timestampTitle(NOW - 90 * MINUTE)).toBe(localStamp(NOW - 90 * MINUTE, true));
  });
});
