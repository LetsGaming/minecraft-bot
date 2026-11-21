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
  probeHead: vi.fn(),
  resolveSkin: vi.fn(),
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
vi.mock("../../src/core/utils/minecraft/skinResolver.js", async (orig) => ({
  ...(await orig<typeof import("../../src/core/utils/minecraft/skinResolver.js")>()),
  resolveSkin: mocks.resolveSkin,
}));
vi.mock("../../src/core/utils/minecraft/playerHead.js", async (orig) => ({
  ...(await orig<typeof import("../../src/core/utils/minecraft/playerHead.js")>()),
  probeHead: mocks.probeHead,
}));

import Fastify from "fastify";
import { closeDbForTesting } from "../../src/core/db/index.js";
import { setSkin } from "../../src/core/utils/stores/headStore.js";
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
  closeDbForTesting();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mocks.listPlayerSummaries.mockReturnValue({ rows: [], total: 0 });
  mocks.sessionHolds.mockReturnValue(false);
  mocks.probeHead.mockResolvedValue({ ok: true, status: 200, bytes: 337, ageSeconds: 6087, cache: "HIT" });
  mocks.resolveSkin.mockResolvedValue({ kind: "unchanged", hash: null });
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
      `https://mc-heads.net/avatar/Steve/64?v=${Math.floor(NOW / 86_400_000)}`,
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

describe("player head info and refresh", () => {
  const day = String(Math.floor(NOW / 86_400_000));

  async function post(url: string) {
    return app().inject({ method: "POST", url });
  }

  it("reports the version, the mc-heads copy age and that nobody refreshed it", async () => {
    const res = await get("/api/servers/smp/players/Steve/head/info");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      version: day,
      reachable: true,
      cacheAgeSeconds: 6087,
      refreshedAt: null,
      keyedBy: "name",
      skinCheckedAt: null,
    });
  });

  it("says when mc-heads returned no image", async () => {
    mocks.probeHead.mockResolvedValue({ ok: false, status: 502, bytes: null, ageSeconds: null, cache: null });
    const body = (await get("/api/servers/smp/players/Steve/head/info")).json();
    expect(body).toMatchObject({ reachable: false, cacheAgeSeconds: null });
  });

  it("refreshes: the version gains a token and the head is fetched under it", async () => {
    const res = await post("/api/servers/smp/players/Steve/head/refresh");
    expect(res.statusCode).toBe(200);
    const info = res.json() as { version: string; refreshedAt: number };
    expect(info.version).toMatch(new RegExp(`^${day}\.`));
    expect(info.refreshedAt).toBe(NOW);

    mocks.fetchIcon.mockResolvedValue({ contentType: "image/png", body: Buffer.from("png") });
    await get("/api/servers/smp/players/Steve/head?v=anything-the-page-sends");
    expect(mocks.fetchIcon).toHaveBeenCalledWith(
      `https://mc-heads.net/avatar/Steve/64?v=${info.version}`,
      expect.any(String),
    );
  });

  it("never lets the request choose the upstream address", async () => {
    mocks.fetchIcon.mockResolvedValue({ contentType: "image/png", body: Buffer.from("png") });
    await get("/api/servers/smp/players/Steve/head?v=1&url=https://evil.example/x.png");
    expect(mocks.fetchIcon.mock.calls[0]![0]).toBe(`https://mc-heads.net/avatar/Steve/64?v=${day}`);
  });

  it("404s an unknown server and 400s an invalid name, for both routes", async () => {
    expect((await post("/api/servers/nope/players/Steve/head/refresh")).statusCode).toBe(404);
    expect((await post("/api/servers/smp/players/..%2Fx/head/refresh")).statusCode).toBe(400);
    expect((await get("/api/servers/nope/players/Steve/head/info")).statusCode).toBe(404);
    expect((await get("/api/servers/smp/players/..%2Fx/head/info")).statusCode).toBe(400);
  });
});

describe("player head and the skin hash", () => {
  const HASH = "d".repeat(64);
  const day = String(Math.floor(NOW / 86_400_000));

  async function post(url: string) {
    return app().inject({ method: "POST", url });
  }

  it("serves the head under the stored skin hash", async () => {
    setSkin("Steve", HASH, NOW - 5 * 60_000);
    mocks.fetchIcon.mockResolvedValue({ contentType: "image/png", body: Buffer.from("png") });
    await get("/api/servers/smp/players/Steve/head");
    expect(mocks.fetchIcon).toHaveBeenCalledWith(
      `https://mc-heads.net/avatar/${HASH}/64?v=${day}`,
      expect.any(String),
    );
  });

  it("reports how the head is keyed and when Mojang was last asked", async () => {
    setSkin("Steve", HASH, NOW - 5 * 60_000);
    const body = (await get("/api/servers/smp/players/Steve/head/info")).json();
    expect(body).toMatchObject({ keyedBy: "skin", skinCheckedAt: NOW - 5 * 60_000 });
    setSkin("Steve", null, NOW - 60_000);
    expect((await get("/api/servers/smp/players/Steve/head/info")).json()).toMatchObject({
      keyedBy: "name",
      skinCheckedAt: NOW - 60_000,
    });
  });

  it("reads the skin from Mojang on refresh and reports what it found", async () => {
    mocks.resolveSkin.mockImplementation(async () => {
      setSkin("Steve", HASH, NOW);
      return { kind: "changed", hash: HASH, previous: null };
    });
    const res = await post("/api/servers/smp/players/Steve/head/refresh");
    expect(res.statusCode).toBe(200);
    expect(mocks.resolveSkin).toHaveBeenCalledWith("Steve");
    expect(res.json()).toMatchObject({ outcome: "changed", keyedBy: "skin", skinCheckedAt: NOW });
  });

  it("still bumps the head and says so when Mojang does not answer", async () => {
    mocks.resolveSkin.mockResolvedValue({ kind: "unavailable", rateLimited: true });
    const body = (await post("/api/servers/smp/players/Steve/head/refresh")).json() as {
      outcome: string;
      version: string;
    };
    expect(body.outcome).toBe("unavailable");
    expect(body.version).toMatch(new RegExp(`^${day}\\.`));
  });

  it("does not ask Mojang for an invalid name or an unknown server", async () => {
    await post("/api/servers/smp/players/..%2Fx/head/refresh");
    await post("/api/servers/nope/players/Steve/head/refresh");
    expect(mocks.resolveSkin).not.toHaveBeenCalled();
  });
});
