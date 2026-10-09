/**
 * Dashboard analytics routes: uptime/activity, players, leaderboard and
 * command usage, through Fastify inject with the core readers mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

const mocks = vi.hoisted(() => ({
  getUptimeStats: vi.fn(),
  loadPlayerCountStore: vi.fn(),
  loadSessionStore: vi.fn(),
  buildLeaderboard: vi.fn(),
  usageByCommand: vi.fn(),
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
  loadPlayerCountStore: mocks.loadPlayerCountStore,
}));
vi.mock("../../src/core/utils/stores/sessionStore.js", async (orig) => ({
  ...(await orig<typeof import("../../src/core/utils/stores/sessionStore.js")>()),
  loadSessionStore: mocks.loadSessionStore,
}));
vi.mock("../../src/core/utils/minecraft/statUtils.js", () => ({
  LEADERBOARD_STATS: { playtime: { label: "Playtime" }, deaths: { label: "Deaths" } },
  buildLeaderboard: mocks.buildLeaderboard,
}));
vi.mock("../../src/core/utils/commands/commandUsage.js", () => ({
  usageByCommand: mocks.usageByCommand,
}));

import Fastify from "fastify";
import { registerAnalyticsRoutes } from "../../src/web/backend/routes/analytics.js";
import { clearLastKnown } from "../../src/core/utils/wrapper/lastKnown.js";

function app() {
  const f = Fastify({ logger: false });
  registerAnalyticsRoutes(f);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  clearLastKnown();
  mocks.getUptimeStats.mockResolvedValue({ pct24h: 100, currentState: "online" });
  mocks.loadPlayerCountStore.mockResolvedValue({ version: 1, servers: {} });
  mocks.loadSessionStore.mockResolvedValue({ version: 1, servers: {} });
  mocks.usageByCommand.mockReturnValue([]);
  mocks.buildLeaderboard.mockResolvedValue({ title: "Board", entries: [] });
});

describe("GET /api/servers/:id/analytics", () => {
  it("404s an unknown server", async () => {
    const res = await app().inject({ method: "GET", url: "/api/servers/nope/analytics" });
    expect(res.statusCode).toBe(404);
  });

  it("filters the activity series to the requested range", async () => {
    mocks.loadPlayerCountStore.mockResolvedValue({
      version: 1,
      servers: {
        smp: [
          { h: NOW - 30 * HOUR, sum: 4, max: 4, samples: 2 },
          { h: NOW - 2 * HOUR, sum: 6, max: 5, samples: 3 },
        ],
      },
    });
    const res = await app().inject({ method: "GET", url: "/api/servers/smp/analytics?hours=24" });
    const body = res.json();
    expect(body.activity.rangeHours).toBe(24);
    expect(body.activity.hours).toEqual([
      { at: NOW - 2 * HOUR, avg: 2, peak: 5, samples: 3 },
    ]);
  });

  it("clamps the activity range to the 14 day retention", async () => {
    const res = await app().inject({ method: "GET", url: "/api/servers/smp/analytics?hours=9999" });
    expect(res.json().activity.rangeHours).toBe(24 * 14);
  });
});

describe("GET /api/servers/:id/analytics/players", () => {
  it("lists players by playtime, counting an open session up to now", async () => {
    mocks.loadSessionStore.mockResolvedValue({
      version: 1,
      servers: {
        smp: {
          a: { name: "A", lastSeen: NOW - 5 * HOUR, sessions: [{ joinedAt: NOW - 6 * HOUR, leftAt: NOW - 5 * HOUR }] },
          b: { name: "B", lastSeen: null, sessions: [{ joinedAt: NOW - 3 * HOUR, leftAt: null }] },
        },
      },
    });
    const res = await app().inject({ method: "GET", url: "/api/servers/smp/analytics/players" });
    const body = res.json();
    expect(body.totalPlayers).toBe(2);
    expect(body.players.map((p: { name: string }) => p.name)).toEqual(["B", "A"]);
    expect(body.players[0]).toMatchObject({ playtimeMs: 3 * HOUR, online: true, sessions: 1 });
  });
});

describe("GET /api/servers/:id/analytics/leaderboard", () => {
  it("400s an unknown stat", async () => {
    const res = await app().inject({ method: "GET", url: "/api/servers/smp/analytics/leaderboard?stat=nope" });
    expect(res.statusCode).toBe(400);
  });

  it("returns the board and the stat catalogue", async () => {
    mocks.buildLeaderboard.mockResolvedValue({
      title: "Board",
      entries: [{ name: "A", value: 3, formatted: "3" }],
    });
    const res = await app().inject({ method: "GET", url: "/api/servers/smp/analytics/leaderboard?stat=deaths" });
    const body = res.json();
    expect(body.stat).toBe("deaths");
    expect(body.entries).toHaveLength(1);
    expect(body.available).toEqual([
      { key: "playtime", label: "Playtime" },
      { key: "deaths", label: "Deaths" },
    ]);
  });

  it("502s when the stats cannot be read and nothing is cached", async () => {
    mocks.buildLeaderboard.mockRejectedValue(new Error("down"));
    const res = await app().inject({ method: "GET", url: "/api/servers/smp/analytics/leaderboard" });
    expect(res.statusCode).toBe(502);
  });
});

describe("GET /api/analytics/commands", () => {
  it("maps usage rows", async () => {
    mocks.usageByCommand.mockReturnValue([
      { command: "daily", surface: "slash", count: 4, users: 2, lastUsedAt: 99 },
    ]);
    const res = await app().inject({ method: "GET", url: "/api/analytics/commands?hours=48" });
    expect(res.json().commands).toEqual([
      { command: "daily", surface: "slash", uses: 4, users: 2, lastUsed: 99 },
    ]);
  });
});
