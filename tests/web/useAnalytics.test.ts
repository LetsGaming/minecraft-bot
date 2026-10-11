import { describe, it, expect, vi, beforeEach } from "vitest";

const apiGet = vi.hoisted(() => vi.fn());
vi.mock("../../src/web/frontend/src/api", async (importActual) => ({
  ...(await importActual<typeof import("../../src/web/frontend/src/api")>()),
  apiGet,
}));

import {
  useAnalytics,
  clampNote,
  formatHours,
} from "../../src/web/frontend/src/composables/useAnalytics.js";

const caps = { activity: 336, uptime: 720, leaderboard: 768, commands: 2160 };

function route(overrides: Record<string, unknown> = {}) {
  apiGet.mockImplementation(async (path: string) => {
    if (path in overrides) {
      const v = overrides[path];
      if (v instanceof Error) throw v;
      return v;
    }
    if (path.includes("/analytics/players")) {
      return { players: [], totalPlayers: 0, rangeHours: 72, sessionsKeptPerPlayer: 20 };
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
    expect(clampNote(720, 336)).toContain("14d");
  });

  it("formats whole days and odd hours", () => {
    expect(formatHours(48)).toBe("2d");
    expect(formatHours(30)).toBe("30h");
  });
});
