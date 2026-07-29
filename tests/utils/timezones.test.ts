/**
 * Per-scope timezones: the zone is a parameter now, resolved per guild for
 * Discord-facing wall-clock and per schedule for server-facing wall-clock.
 *
 * Also pins the month-end bug the refactor fixed: nextMidnightEpoch used to
 * build "2026-01-32T00:00:00Z" by pasting day+1 into an ISO string, get
 * Invalid Date, and return NaN — so the nightly channel purge misfired on
 * the last day of every month.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConfig: Record<string, unknown> = {};
vi.mock("../../src/core/config.js", () => ({
  loadConfig: () => mockConfig,
}));
vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  nextMidnightEpoch,
  nextTimeOfDayEpoch,
  msUntilMidnight,
  localDayOfWeek,
  localHourOfDay,
  isValidTimeZone,
} from "../../src/core/utils/time.js";
import {
  guildTimeZone,
  scheduleTimeZone,
  _resetTimezoneWarnings,
} from "../../src/core/utils/config/timezones.js";
import { log } from "../../src/core/utils/logger.js";

describe("nextMidnightEpoch", () => {
  it("does not return NaN on the last day of a month", () => {
    // The regression: 31 Jan + 1 gave "2026-01-32", an Invalid Date, and a
    // NaN delay makes setTimeout fire immediately.
    for (const day of [
      "2026-01-31T23:00:00Z",
      "2026-02-28T23:00:00Z",
      "2026-04-30T22:30:00Z",
      "2026-12-31T23:59:00Z",
    ]) {
      const from = Date.parse(day);
      const next = nextMidnightEpoch("UTC", from);
      expect(Number.isFinite(next)).toBe(true);
      expect(next).toBeGreaterThan(from);
    }
  });

  it("rolls into the next month, and the next year", () => {
    expect(new Date(nextMidnightEpoch("UTC", Date.parse("2026-01-31T12:00:00Z")))
      .toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(new Date(nextMidnightEpoch("UTC", Date.parse("2026-12-31T12:00:00Z")))
      .toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("gives each zone its own midnight", () => {
    const from = Date.parse("2026-06-15T12:00:00Z");
    const berlin = nextMidnightEpoch("Europe/Berlin", from);
    const denver = nextMidnightEpoch("America/Denver", from);
    // Berlin is UTC+2 in June, Denver UTC-6: midnights are 8h apart.
    expect(berlin).not.toBe(denver);
    expect(denver - berlin).toBe(8 * 3_600_000);
  });

  it("msUntilMidnight is positive and under 24h", () => {
    const ms = msUntilMidnight("Europe/Berlin", Date.parse("2026-03-10T23:30:00Z"));
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(24 * 3_600_000);
  });
});

describe("nextTimeOfDayEpoch", () => {
  it("is strictly in the future", () => {
    const from = Date.parse("2026-05-01T04:00:00Z");
    // 04:00 today has already arrived, so it must roll to tomorrow.
    expect(nextTimeOfDayEpoch(4, 0, "UTC", from)).toBe(
      Date.parse("2026-05-02T04:00:00Z"),
    );
  });

  it("survives a spring-forward transition", () => {
    // 02:00 does not exist in Berlin on 2026-03-29; the helper must still
    // return a finite epoch after `from` rather than looping or NaN-ing.
    const from = Date.parse("2026-03-28T12:00:00Z");
    const next = nextTimeOfDayEpoch(2, 30, "Europe/Berlin", from);
    expect(Number.isFinite(next)).toBe(true);
    expect(next).toBeGreaterThan(from);
  });
});

describe("localDayOfWeek / localHourOfDay", () => {
  it("bucket by the requested zone, not the process zone", () => {
    // 23:30 UTC on a Monday is already Tuesday in Berlin.
    const at = Date.parse("2026-06-15T23:30:00Z");
    expect(localDayOfWeek(at, "UTC")).toBe(1);
    expect(localDayOfWeek(at, "Europe/Berlin")).toBe(2);
    expect(localHourOfDay(at, "UTC")).toBe(23);
    expect(localHourOfDay(at, "Europe/Berlin")).toBe(1);
  });

  it("reads midnight as hour 0, not 24", () => {
    expect(localHourOfDay(Date.parse("2026-06-15T00:15:00Z"), "UTC")).toBe(0);
  });
});

describe("timezone resolution", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockConfig)) delete mockConfig[key];
    _resetTimezoneWarnings();
    vi.clearAllMocks();
  });

  it("defaults to UTC when nothing is configured", () => {
    expect(guildTimeZone("1")).toBe("UTC");
    expect(scheduleTimeZone("survival")).toBe("UTC");
  });

  it("prefers the guild's zone over the global one", () => {
    mockConfig.timezone = "Europe/Berlin";
    mockConfig.guilds = { "1": { timezone: "America/Denver" }, "2": {} };
    expect(guildTimeZone("1")).toBe("America/Denver");
    expect(guildTimeZone("2")).toBe("Europe/Berlin");
  });

  it("takes a schedule's zone from the schedule, not from any guild", () => {
    // The case the split exists for: one server, two guilds, and a restart
    // time that belongs to neither of them.
    mockConfig.guilds = { "1": { timezone: "America/Denver" } };
    mockConfig.schedules = { survival: { timezone: "Europe/Berlin" } };
    expect(scheduleTimeZone("survival")).toBe("Europe/Berlin");
  });

  it("falls back to UTC and warns once for an unknown zone", () => {
    mockConfig.guilds = { "1": { timezone: "Mars/Olympus" } };
    expect(guildTimeZone("1")).toBe("UTC");
    expect(guildTimeZone("1")).toBe("UTC");
    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1);
  });

  it("returns UTC rather than throwing when config cannot be read", () => {
    // A caller deep in a scheduler must not die because config is mid-write.
    expect(isValidTimeZone(guildTimeZone(null))).toBe(true);
  });
});
