/**
 * Assorted regression tests:
 *  - whitelist cache invalidation + TTL
 *  - buildLeaderboard never deletes stats files
 *  - strict server instance lookup (no silent fallback)
 *  - namespaced item IDs are not double-prefixed
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/common/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/common/utils/serverAccess.js", () => ({
  readWhitelist: vi.fn().mockResolvedValue([{ name: "Alice", uuid: "u1" }]),
  readStats: vi.fn().mockResolvedValue({ stats: {} }),
  readUserCache: vi.fn().mockResolvedValue([]),
  listStatsUuids: vi.fn().mockResolvedValue(["u1", "u-orphan"]),
  deleteStatsFile: vi.fn().mockResolvedValue(true),
  readLevelName: vi.fn().mockResolvedValue("world"),
  tailLog: vi.fn().mockResolvedValue(""),
}));

vi.mock("../src/common/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({ servers: {}, guilds: {} }),
}));

import * as serverAccess from "../src/common/utils/serverAccess.js";
import {
  loadWhitelist,
  loadKnownPlayers,
  invalidateWhitelistCache,
} from "../src/common/utils/utils.js";
import { buildLeaderboard, invalidateAllStatsCache } from "../src/common/utils/statUtils.js";
import { initServers, getServerInstance, getFirstInstance } from "../src/common/utils/server.js";
import type { ServerInstance } from "../src/common/utils/server.js";

function makeServer(id = "survival"): ServerInstance {
  return { id, config: { id, useRcon: false } } as unknown as ServerInstance;
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateWhitelistCache();
  invalidateAllStatsCache();
});

// ── Whitelist cache ────────────────────────────────────────────────────────

describe("whitelist cache invalidation", () => {
  it("serves the cache on repeated reads", async () => {
    const srv = makeServer();
    await loadWhitelist(false, srv);
    await loadWhitelist(false, srv);
    expect(serverAccess.readWhitelist).toHaveBeenCalledTimes(1);
  });

  it("re-reads after invalidateWhitelistCache so a freshly added player appears without restart", async () => {
    const srv = makeServer();
    expect((await loadWhitelist(false, srv))?.map((p) => p.name)).toEqual([
      "Alice",
    ]);

    // Simulate /whitelist add Bob → file changed + cache invalidated
    vi.mocked(serverAccess.readWhitelist).mockResolvedValue([
      { name: "Alice", uuid: "u1" },
      { name: "Bob", uuid: "u2" },
    ] as never);
    invalidateWhitelistCache(srv.id);

    expect((await loadWhitelist(false, srv))?.map((p) => p.name)).toEqual([
      "Alice",
      "Bob",
    ]);
  });

  it("expires the cache after the TTL even without explicit invalidation", async () => {
    vi.useFakeTimers();
    try {
      const srv = makeServer();
      await loadWhitelist(false, srv);
      vi.advanceTimersByTime(61_000);
      await loadWhitelist(false, srv);
      expect(serverAccess.readWhitelist).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── Leaderboard must never delete stats files ──────────────────────────────

describe("buildLeaderboard never deletes stats", () => {
  it("skips UUIDs missing from the whitelist without calling deleteStatsFile", async () => {
    const srv = makeServer();
    // u-orphan is in stats but not on the whitelist
    const result = await buildLeaderboard("deaths", { server: srv });
    expect(serverAccess.deleteStatsFile).not.toHaveBeenCalled();
    // Only the whitelisted player appears
    expect(result.entries.map((e) => e.name)).toEqual(["Alice"]);
  });
});

// ── Strict server lookup ───────────────────────────────────────────────────

describe("strict server instance lookup", () => {
  it("returns null for an unknown ID even when instances exist", () => {
    initServers({
      survival: { id: "survival", useRcon: false } as never,
    });
    expect(getServerInstance("survvial")).toBeNull(); // typo must NOT fall back
    expect(getServerInstance("survival")).not.toBeNull();
  });

  it("getFirstInstance provides the explicit fallback", () => {
    expect(getFirstInstance()).not.toBeNull();
    expect(getFirstInstance()!.id).toBe("survival");
  });
});

// ── Item ID namespacing ────────────────────────────────────────────────────

describe("daily give() item prefixing", () => {
  it("prefixes bare IDs and leaves namespaced IDs untouched", async () => {
    const { give } = await import(
      "../src/bot/commands/connection/daily/daily.js"
    );
    const sendCommand = vi.fn().mockResolvedValue(null);
    const srv = {
      id: "s",
      config: { id: "s", useRcon: false },
      sendCommand,
    } as unknown as ServerInstance;

    await give(srv, "Steve", { item: "diamond", amount: 2 });
    expect(sendCommand).toHaveBeenLastCalledWith(
      "give Steve minecraft:diamond 2",
    );

    await give(srv, "Steve", { item: "create:brass_ingot", amount: 1 });
    expect(sendCommand).toHaveBeenLastCalledWith(
      "give Steve create:brass_ingot 1",
    );
  });

  it("fails the claim when an RCON server does not confirm the give", async () => {
    const { give } = await import(
      "../src/bot/commands/connection/daily/daily.js"
    );
    const srv = {
      id: "s",
      config: { id: "s", useRcon: true },
      sendCommand: vi
        .fn()
        .mockResolvedValue("Unknown item 'minecraft:not_an_item'"),
    } as unknown as ServerInstance;

    expect(await give(srv, "Steve", { item: "not_an_item" })).toBe(false);

    const ok = {
      id: "s",
      config: { id: "s", useRcon: true },
      sendCommand: vi.fn().mockResolvedValue("Gave 1 [Diamond] to Steve"),
    } as unknown as ServerInstance;
    expect(await give(ok, "Steve", { item: "diamond" })).toBe(true);
  });
});


// ── Name resolution without a whitelist ─────────────────────────────────────
// Servers running with the whitelist disabled still have usercache.json;
// stats, leaderboards, and autocomplete resolve names through it.

describe("loadKnownPlayers", () => {
  it("falls back to the usercache when the whitelist is empty", async () => {
    invalidateWhitelistCache();
    vi.mocked(serverAccess.readWhitelist).mockResolvedValue([]);
    vi.mocked(serverAccess.readUserCache).mockResolvedValue([
      { name: "Casey", uuid: "u1" },
    ] as never);

    const known = await loadKnownPlayers(false, makeServer());
    expect(known).toEqual([{ name: "Casey", uuid: "u1" }]);
  });

  it("lets the whitelist win name conflicts and appends usercache-only players", async () => {
    invalidateWhitelistCache();
    vi.mocked(serverAccess.readWhitelist).mockResolvedValue([
      { name: "Alice", uuid: "u1" },
    ] as never);
    vi.mocked(serverAccess.readUserCache).mockResolvedValue([
      { name: "OldAlice", uuid: "u1" },
      { name: "Casey", uuid: "u2" },
    ] as never);

    const known = await loadKnownPlayers(false, makeServer());
    expect(known.map((p) => p.name)).toEqual(["Alice", "Casey"]);
  });

  it("dedupes the usercache by uuid, newest entry first", async () => {
    invalidateWhitelistCache();
    vi.mocked(serverAccess.readWhitelist).mockResolvedValue([]);
    // usercache.json appends as players join → the later entry is newer
    vi.mocked(serverAccess.readUserCache).mockResolvedValue([
      { name: "OldName", uuid: "u1" },
      { name: "NewName", uuid: "u1" },
      { name: "Zed", uuid: "u3" },
    ] as never);

    const known = await loadKnownPlayers(false, makeServer());
    expect(known.map((p) => p.name)).toEqual(["Zed", "NewName"]);
  });

  it("invalidateWhitelistCache drops the usercache cache too", async () => {
    invalidateWhitelistCache();
    vi.mocked(serverAccess.readWhitelist).mockResolvedValue([]);
    vi.mocked(serverAccess.readUserCache).mockResolvedValue([] as never);
    const srv = makeServer();

    await loadKnownPlayers(false, srv);
    await loadKnownPlayers(false, srv); // served from cache
    expect(serverAccess.readUserCache).toHaveBeenCalledTimes(1);

    invalidateWhitelistCache(srv.id);
    await loadKnownPlayers(false, srv);
    expect(serverAccess.readUserCache).toHaveBeenCalledTimes(2);
  });
});

describe("leaderboards on servers without a whitelist", () => {
  it("names entries from the usercache instead of skipping everyone", async () => {
    invalidateWhitelistCache();
    invalidateAllStatsCache();
    vi.mocked(serverAccess.readWhitelist).mockResolvedValue([]);
    vi.mocked(serverAccess.readUserCache).mockResolvedValue([
      { name: "Casey", uuid: "u1" },
    ] as never);

    const result = await buildLeaderboard("deaths", { server: makeServer() });
    expect(result.entries.map((e) => e.name)).toEqual(["Casey"]);
    // u-orphan has stats but no name in either source → still skipped,
    // and nothing is ever deleted
    expect(serverAccess.deleteStatsFile).not.toHaveBeenCalled();
  });
});
