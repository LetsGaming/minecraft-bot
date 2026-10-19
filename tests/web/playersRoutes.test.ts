/**
 * Player audit routes through Fastify inject, with the core readers mocked:
 * the list's parsing and clamping, the detail's sensitive-access decision,
 * name validation, and the head proxy's fixed host.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

const mocks = vi.hoisted(() => ({
  listPlayerSummaries: vi.fn(),
  buildPlayerDetail: vi.fn(),
  sessionHolds: vi.fn(),
  fetchIcon: vi.fn(),
}));

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/core/utils/server/server.js", () => ({
  getServerInstance: vi.fn((id: string) => (id === "smp" ? { id: "smp" } : null)),
}));
vi.mock("../../src/core/utils/stores/sessionStore.js", async (orig) => ({
  ...(await orig<typeof import("../../src/core/utils/stores/sessionStore.js")>()),
  listPlayerSummaries: mocks.listPlayerSummaries,
}));
vi.mock("../../src/core/utils/minecraft/playerDetail.js", () => ({
  buildPlayerDetail: mocks.buildPlayerDetail,
}));
vi.mock("../../src/web/backend/auth/auth.js", () => ({
  currentSession: vi.fn(() => ({ uid: "u1" })),
}));
vi.mock("../../src/web/backend/auth/capabilities.js", () => ({
  sessionHolds: mocks.sessionHolds,
}));
vi.mock("../../src/web/backend/auth/discordRest.js", () => ({
  fetchDiscordUserName: vi.fn(),
}));
vi.mock("../../src/web/backend/iconProxy.js", () => ({
  fetchIcon: mocks.fetchIcon,
}));

import Fastify from "fastify";
import { registerErrorHandler } from "../../src/web/backend/errors.js";
import { registerPlayerRoutes } from "../../src/web/backend/routes/players.js";

function app() {
  const f = Fastify({ logger: false });
  registerErrorHandler(f);
  registerPlayerRoutes(f);
  return f;
}

async function get(url: string) {
  return app().inject({ method: "GET", url });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.listPlayerSummaries.mockReturnValue({ rows: [], total: 0 });
  mocks.sessionHolds.mockReturnValue(false);
});

describe("GET /api/servers/:id/players", () => {
  it("404s an unknown server", async () => {
    expect((await get("/api/servers/nope/players")).statusCode).toBe(404);
  });

  it("defaults to a 14 day window, all players, playtime first", async () => {
    const res = await get("/api/servers/smp/players");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      players: [],
      total: 0,
      rangeHours: 14 * 24,
      historyDays: 365,
      limit: 20,
      offset: 0,
    });
    expect(mocks.listPlayerSummaries).toHaveBeenCalledWith(
      "smp",
      expect.objectContaining({
        now: NOW,
        sinceMs: NOW - 14 * 24 * HOUR,
        status: "all",
        sort: "playtimeMs",
        order: "desc",
        limit: 20,
        offset: 0,
      }),
    );
  });

  it("passes filters through and clamps numbers", async () => {
    await get("/api/servers/smp/players?q=ste&status=quiet&quietDays=30&hours=99999999&sort=name&limit=500&offset=40");
    expect(mocks.listPlayerSummaries).toHaveBeenCalledWith(
      "smp",
      expect.objectContaining({
        q: "ste",
        status: "quiet",
        quietBeforeMs: NOW - 30 * 24 * HOUR,
        sinceMs: NOW - 365 * 24 * HOUR,
        sort: "name",
        order: "asc",
        limit: 50,
        offset: 40,
      }),
    );
  });

  it("rejects an unknown status, sort or order with a 400", async () => {
    expect((await get("/api/servers/smp/players?status=banned")).statusCode).toBe(400);
    expect((await get("/api/servers/smp/players?sort=password")).statusCode).toBe(400);
    expect((await get("/api/servers/smp/players?order=sideways")).statusCode).toBe(400);
    expect(mocks.listPlayerSummaries).not.toHaveBeenCalled();
  });

  it("returns a generic 500 when the store fails", async () => {
    mocks.listPlayerSummaries.mockImplementation(() => {
      throw new Error("disk path /secret");
    });
    const res = await get("/api/servers/smp/players");
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("/secret");
  });
});

describe("GET /api/servers/:id/players/:name", () => {
  const detail = { serverId: "smp", name: "Steve", sensitiveAccess: false, sensitive: null };

  it("asks for sensitive data only when the session holds audit:read on that server", async () => {
    mocks.buildPlayerDetail.mockResolvedValue(detail);

    await get("/api/servers/smp/players/Steve");
    expect(mocks.sessionHolds).toHaveBeenCalledWith({ uid: "u1" }, "audit:read", "smp");
    expect(mocks.buildPlayerDetail).toHaveBeenLastCalledWith(
      expect.objectContaining({ serverId: "smp", name: "Steve", includeSensitive: false }),
    );

    mocks.sessionHolds.mockReturnValue(true);
    await get("/api/servers/smp/players/Steve");
    expect(mocks.buildPlayerDetail).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeSensitive: true }),
    );
  });

  it("returns the assembled detail", async () => {
    mocks.buildPlayerDetail.mockResolvedValue(detail);
    const res = await get("/api/servers/smp/players/Steve");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(detail);
  });

  it("404s a player nothing is known about", async () => {
    mocks.buildPlayerDetail.mockResolvedValue(null);
    expect((await get("/api/servers/smp/players/Ghost")).statusCode).toBe(404);
  });

  it("400s a name that is not a Minecraft name, before reading anything", async () => {
    const res = await get("/api/servers/smp/players/bad%20name%3B");
    expect(res.statusCode).toBe(400);
    expect(mocks.buildPlayerDetail).not.toHaveBeenCalled();
  });

  it("404s an unknown server", async () => {
    expect((await get("/api/servers/nope/players/Steve")).statusCode).toBe(404);
  });

  it("returns a generic 500 when assembly throws", async () => {
    mocks.buildPlayerDetail.mockRejectedValue(new Error("db at C:\\private"));
    const res = await get("/api/servers/smp/players/Steve");
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("private");
  });
});

describe("GET /api/servers/:id/players/:name/head", () => {
  it("fetches the head from the fixed host by encoded name and serves it same-origin", async () => {
    mocks.fetchIcon.mockResolvedValue({ contentType: "image/png", body: Buffer.from("png") });
    const res = await get("/api/servers/smp/players/Steve/head");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(mocks.fetchIcon).toHaveBeenCalledWith(
      "https://mc-heads.net/avatar/Steve/64",
      expect.any(String),
    );
  });

  it("never relays an invalid name", async () => {
    const res = await get("/api/servers/smp/players/..%2F..%2Fx/head");
    expect(res.statusCode).toBe(400);
    expect(mocks.fetchIcon).not.toHaveBeenCalled();
  });

  it("answers 502 when the upstream fails", async () => {
    mocks.fetchIcon.mockRejectedValue(new Error("boom"));
    expect((await get("/api/servers/smp/players/Steve/head")).statusCode).toBe(502);
  });
});
