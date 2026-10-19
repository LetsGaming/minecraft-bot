import { describe, it, expect, vi, beforeEach } from "vitest";

const apiGet = vi.hoisted(() => vi.fn());
vi.mock("../../src/web/frontend/src/api", async (importActual) => ({
  ...(await importActual<typeof import("../../src/web/frontend/src/api")>()),
  apiGet,
}));

import {
  useAnalytics,
  bucketActivity,
  clampNote,
  formatHours,
} from "../../src/web/frontend/src/composables/useAnalytics.js";

const caps = { activity: 2160, uptime: 720, leaderboard: 768, commands: 2160, sessions: 8760 };

function route(overrides: Record<string, unknown> = {}) {
  apiGet.mockImplementation(async (path: string) => {
    if (path in overrides) {
      const v = overrides[path];
      if (v instanceof Error) throw v;
      return v;
    }
    if (path.includes("/analytics/players")) {
      return { players: [], totalPlayers: 0, rangeHours: 72, historyDays: 365 };
    }
    if (path.includes("/analytics/leaderboard")) {
      return {
        stat: "playtime",
        title: "Board",
        entries: [{ name: "A", value: 1, formatted: "1" }],
        stale: null,
        available: [{ key: "playtime", label: "Playtime" }],
        rangeHours: 72,
        baselineAt: 5,
        historyShorterThanRange: true,
        caps,
      };
    }
    if (path.startsWith("/api/analytics/commands")) {
      return { since: 0, rangeHours: 72, commands: [], caps };
    }
    return {
      uptime: { pct24h: 100 },
      activity: { rangeHours: 72, hours: [], busiest: [] },
      caps,
    };
  });
}

beforeEach(() => {
  apiGet.mockReset();
});

describe("useAnalytics", () => {
  it("sends the range to every request of a load", async () => {
    route();
    await useAnalytics().load("smp", 72);
    const paths = apiGet.mock.calls.map((c) => c[0] as string).sort();
    expect(paths).toEqual([
      "/api/analytics/commands?hours=72",
      "/api/servers/smp/analytics/players?hours=72",
      "/api/servers/smp/analytics?hours=72",
    ]);
  });

  it("sends the range with the leaderboard stat", async () => {
    route();
    const a = useAnalytics();
    await a.loadBoard("smp", "deaths", 168);
    expect(apiGet).toHaveBeenCalledWith(
      "/api/servers/smp/analytics/leaderboard?stat=deaths&hours=168",
    );
    expect(a.boardHistoryShort.value).toBe(true);
    expect(a.boardBaselineAt.value).toBe(5);
    expect(a.caps.value).toEqual(caps);
  });

  it("keeps sections independent when one request fails", async () => {
    route({ "/api/analytics/commands?hours=72": new Error("boom") });
    const a = useAnalytics();
    await a.load("smp", 72);
    expect(a.uptime.value).not.toBeNull();
    expect(a.commands.value).toEqual([]);
    expect(a.error.value).toBe("");
    expect(a.usageFailure.value).toEqual({ error: "boom", kind: "failed" });
    expect(a.playersFailure.value).toBeNull();
    expect(a.loading.value).toBe(false);
    expect(a.loaded.value).toBe(true);
  });

  it("reports a board failure without touching the other sections", async () => {
    route({ "/api/servers/smp/analytics/leaderboard?stat=playtime&hours=72": new Error("502") });
    const a = useAnalytics();
    await a.loadBoard("smp", "playtime", 72);
    expect(a.boardError.value).not.toBe("");
    expect(a.board.value).toEqual([]);
    expect(a.boardLoading.value).toBe(false);
  });
});

describe("clampNote", () => {
  it("is empty when the section covered the whole range", () => {
    expect(clampNote(168, 168)).toBe("");
    expect(clampNote(168, null)).toBe("");
  });

  it("names the range actually shown when it was clamped", () => {
    expect(clampNote(2400, 2160)).toContain("90d");
  });

  it("formats whole days and odd hours", () => {
    expect(formatHours(48)).toBe("2d");
    expect(formatHours(30)).toBe("30h");
  });
});

describe("bucketActivity", () => {
  const H = 3_600_000;
  const D = 24 * H;

  it("returns hourly data unchanged", () => {
    const hours = [{ at: 0, avg: 1, peak: 2, samples: 3 }];
    expect(bucketActivity(hours, "hour")).toBe(hours);
  });

  it("collapses hours into UTC days, weighting the average by samples", () => {
    const days = bucketActivity(
      [
        { at: 0, avg: 2, peak: 4, samples: 1 },
        { at: H, avg: 8, peak: 9, samples: 3 },
        { at: D + H, avg: 1, peak: 1, samples: 2 },
      ],
      "day",
    );
    expect(days).toEqual([
      { at: 0, avg: (2 * 1 + 8 * 3) / 4, peak: 9, samples: 4 },
      { at: D, avg: 1, peak: 1, samples: 2 },
    ]);
  });

  it("keeps days in order and tolerates empty input", () => {
    expect(bucketActivity([], "day")).toEqual([]);
    const out = bucketActivity(
      [
        { at: 3 * D, avg: 1, peak: 1, samples: 1 },
        { at: D, avg: 1, peak: 1, samples: 1 },
      ],
      "day",
    );
    expect(out.map((d) => d.at)).toEqual([D, 3 * D]);
  });
});
