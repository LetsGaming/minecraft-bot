/**
 * Dashboard analytics routes: uptime/activity, players, leaderboard and
 * command usage, through Fastify inject with the core readers mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

const mocks = vi.hoisted(() => ({
  getUptimeStats: vi.fn(),
  loadPlayerCountSeries: vi.fn(),
  listPlayerSummaries: vi.fn(),
  buildLeaderboard: vi.fn(),
  usageByCommandSince: vi.fn(),
  getSnapshotClosestTo: vi.fn(),
}));

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/core/utils/server/server.js", () => ({
  getServerInstance: vi.fn((id: string) => (id === "smp" ? { id: "smp" } : null)),
}));
vi.mock("../../src/core/utils/stores/uptimeTracker.js", () => ({
  getUptimeStats: mocks.getUptimeStats,
}));
vi.mock("../../src/core/utils/stores/playerCountHistory.js", async (orig) => ({
  ...(await orig<typeof import("../../src/core/utils/stores/playerCountHistory.js")>()),
  loadPlayerCountSeries: mocks.loadPlayerCountSeries,
}));
vi.mock("../../src/core/utils/stores/sessionStore.js", async (orig) => ({
  ...(await orig<typeof import("../../src/core/utils/stores/sessionStore.js")>()),
  listPlayerSummaries: mocks.listPlayerSummaries,
}));
vi.mock("../../src/core/utils/minecraft/statUtils.js", () => ({
  LEADERBOARD_STATS: { playtime: { label: "Playtime" }, deaths: { label: "Deaths" } },
  buildLeaderboard: mocks.buildLeaderboard,
}));
vi.mock("../../src/core/utils/commands/commandUsage.js", () => ({
  usageByCommandSince: mocks.usageByCommandSince,
}));
vi.mock("../../src/core/utils/minecraft/snapshotUtils.js", () => ({
  getSnapshotClosestTo: mocks.getSnapshotClosestTo,
}));

import Fastify from "fastify";
import { registerAnalyticsRoutes } from "../../src/web/backend/routes/analytics.js";
import { clearLastKnown } from "../../src/core/utils/wrapper/lastKnown.js";

function app() {
  const f = Fastify({ logger: false });
  registerAnalyticsRoutes(f);
  return f;
}

async function get(url: string) {
  return app().inject({ method: "GET", url });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  clearLastKnown();
  mocks.getUptimeStats.mockResolvedValue({ pct24h: 100, currentState: "online" });
  mocks.loadPlayerCountSeries.mockReturnValue([]);
  mocks.listPlayerSummaries.mockReturnValue({ rows: [], total: 0 });
  mocks.usageByCommandSince.mockReturnValue([]);
  mocks.getSnapshotClosestTo.mockResolvedValue(null);
  mocks.buildLeaderboard.mockResolvedValue({ title: "Board", entries: [] });
});

describe("GET /api/servers/:id/analytics", () => {
  it("404s an unknown server", async () => {
    expect((await get("/api/servers/nope/analytics")).statusCode).toBe(404);
  });

  it("reads the activity series from the requested start and shapes the buckets", async () => {
    mocks.loadPlayerCountSeries.mockReturnValue([
      { h: NOW - 2 * HOUR, sum: 6, max: 5, samples: 3 },
    ]);
    const body = (await get("/api/servers/smp/analytics?hours=24")).json();
    expect(mocks.loadPlayerCountSeries).toHaveBeenCalledWith("smp", NOW - 24 * HOUR);
    expect(body.activity.rangeHours).toBe(24);
    expect(body.activity.hours).toEqual([{ at: NOW - 2 * HOUR, avg: 2, peak: 5, samples: 3 }]);
  });

  it("clamps activity to 90 days but uptime to 30 days", async () => {
    const body = (await get("/api/servers/smp/analytics?hours=9999")).json();
    expect(body.activity.rangeHours).toBe(24 * 90);
    expect(mocks.getUptimeStats).toHaveBeenCalledWith("smp", { rangeHours: 24 * 30 });
  });

  it("passes the range to uptime and reports the per-section caps", async () => {
    const body = (await get("/api/servers/smp/analytics?hours=72")).json();
    expect(mocks.getUptimeStats).toHaveBeenCalledWith("smp", { rangeHours: 72 });
    expect(body.caps).toEqual({
      activity: 24 * 90,
      uptime: 24 * 30,
      leaderboard: 24 * 32,
      commands: 24 * 90,
      sessions: 24 * 365,
    });
  });
});

describe("GET /api/servers/:id/analytics/players", () => {
  const row = (name: string) => ({
    name,
    online: false,
    lastSeen: NOW - HOUR,
    firstSeen: NOW - 5 * HOUR,
    sessions: 1,
    playtimeMs: HOUR,
  });

  it("returns the session store's summaries with the retention in days", async () => {
    mocks.listPlayerSummaries.mockReturnValue({ rows: [row("A"), row("B")], total: 2 });
    const body = (await get("/api/servers/smp/analytics/players")).json();
    expect(body.totalPlayers).toBe(2);
    expect(body.players.map((p: { name: string }) => p.name)).toEqual(["A", "B"]);
    expect(body.historyDays).toBe(365);
  });

  it("asks for the requested window and reports the clamped range", async () => {
    mocks.listPlayerSummaries.mockReturnValue({ rows: [], total: 0 });
    const body = (await get("/api/servers/smp/analytics/players?hours=24")).json();
    expect(body.rangeHours).toBe(24);
    expect(mocks.listPlayerSummaries).toHaveBeenCalledWith(
      "smp",
      expect.objectContaining({ sinceMs: NOW - 24 * HOUR, status: "all" }),
    );
  });

  it("clamps the range to the session retention", async () => {
    mocks.listPlayerSummaries.mockReturnValue({ rows: [], total: 0 });
    const body = (await get("/api/servers/smp/analytics/players?hours=999999")).json();
    expect(body.rangeHours).toBe(24 * 365);
  });
});

describe("GET /api/servers/:id/analytics/leaderboard", () => {
  it("400s an unknown stat", async () => {
    expect((await get("/api/servers/smp/analytics/leaderboard?stat=nope")).statusCode).toBe(400);
  });

  it("returns an all-time board and the stat catalogue without a range", async () => {
    mocks.buildLeaderboard.mockResolvedValue({
      title: "Board",
      entries: [{ name: "A", value: 3, formatted: "3" }],
    });
    const body = (await get("/api/servers/smp/analytics/leaderboard?stat=deaths")).json();
    expect(body).toMatchObject({
      stat: "deaths",
      rangeHours: null,
      baselineAt: null,
      historyShorterThanRange: false,
    });
    expect(mocks.getSnapshotClosestTo).not.toHaveBeenCalled();
    expect(body.available).toEqual([
      { key: "playtime", label: "Playtime" },
      { key: "deaths", label: "Deaths" },
    ]);
  });

  it("diffs against the snapshot closest to the start of the range", async () => {
    const players = { uuid1: { deaths: 1 } };
    mocks.getSnapshotClosestTo.mockResolvedValue({ timestamp: NOW - 25 * HOUR, players });
    const body = (await get("/api/servers/smp/analytics/leaderboard?stat=deaths&hours=24")).json();
    expect(mocks.getSnapshotClosestTo).toHaveBeenCalledWith("smp", NOW - 24 * HOUR);
    expect(mocks.buildLeaderboard).toHaveBeenCalledWith(
      "deaths",
      expect.objectContaining({ baseline: players, periodLabel: "1d" }),
    );
    expect(body).toMatchObject({
      rangeHours: 24,
      baselineAt: NOW - 25 * HOUR,
      historyShorterThanRange: false,
    });
  });

  it("flags a snapshot history that starts after the range does", async () => {
    mocks.getSnapshotClosestTo.mockResolvedValue({ timestamp: NOW - 5 * HOUR, players: {} });
    const body = (await get("/api/servers/smp/analytics/leaderboard?hours=168")).json();
    expect(body.historyShorterThanRange).toBe(true);
  });

  it("flags a missing snapshot history and shows all-time numbers", async () => {
    const body = (await get("/api/servers/smp/analytics/leaderboard?hours=24")).json();
    expect(body).toMatchObject({ baselineAt: null, historyShorterThanRange: true });
    expect(mocks.buildLeaderboard).toHaveBeenCalledWith(
      "playtime",
      expect.objectContaining({ baseline: null }),
    );
  });

  it("clamps the range to the snapshot retention", async () => {
    const body = (await get("/api/servers/smp/analytics/leaderboard?hours=99999")).json();
    expect(body.rangeHours).toBe(24 * 32);
  });

  it("keeps boards for different ranges apart in the last-known cache", async () => {
    mocks.getSnapshotClosestTo.mockResolvedValue({ timestamp: NOW - 25 * HOUR, players: {} });
    await get("/api/servers/smp/analytics/leaderboard?hours=24");

    mocks.buildLeaderboard.mockRejectedValue(new Error("down"));
    const week = await get("/api/servers/smp/analytics/leaderboard?hours=168");
    expect(week.statusCode).toBe(502);
    const day = await get("/api/servers/smp/analytics/leaderboard?hours=24");
    expect(day.statusCode).toBe(200);
    expect(day.json().stale).not.toBeNull();
  });

  it("502s when the stats cannot be read and nothing is cached", async () => {
    mocks.buildLeaderboard.mockRejectedValue(new Error("down"));
    expect((await get("/api/servers/smp/analytics/leaderboard")).statusCode).toBe(502);
  });
});

describe("GET /api/analytics/commands", () => {
  it("maps usage rows and uses an hour-precise window", async () => {
    mocks.usageByCommandSince.mockReturnValue([
      { command: "daily", surface: "slash", count: 4, users: 2, lastUsedAt: 99 },
    ]);
    const body = (await get("/api/analytics/commands?hours=36")).json();
    expect(mocks.usageByCommandSince).toHaveBeenCalledWith(NOW - 36 * HOUR);
    expect(body.rangeHours).toBe(36);
    expect(body.commands).toEqual([
      { command: "daily", surface: "slash", uses: 4, users: 2, lastUsed: 99 },
    ]);
  });

  it("clamps to the 90 day retention", async () => {
    const body = (await get("/api/analytics/commands?hours=999999")).json();
    expect(body.rangeHours).toBe(24 * 90);
  });
});
