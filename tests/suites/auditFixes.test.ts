/**
 * Regression tests for the audit fixes:
 *  - C-02: whitelist cache invalidation + TTL
 *  - H-05: buildLeaderboard never deletes stats files
 *  - H-01: strict server instance lookup
 *  - M-12: namespaced item IDs are not double-prefixed
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/core/utils/server/serverAccess.js", () => ({
  sendCommand: vi.fn().mockResolvedValue(null),
  readWhitelist: vi.fn().mockResolvedValue([{ name: "Alice", uuid: "u1" }]),
  readUserCache: vi.fn().mockResolvedValue([]),
  // null: simulates a wrapper too old to serve /stats/bulk, so these tests
  // keep exercising the per-uuid fallback (listStatsUuids + readStats).
  readAllStats: vi.fn().mockResolvedValue(null),
  readStats: vi.fn().mockResolvedValue({ stats: {} }),
  listStatsUuids: vi.fn().mockResolvedValue(["u1", "u-orphan"]),
  deleteStatsFile: vi.fn().mockResolvedValue(true),
  readLevelName: vi.fn().mockResolvedValue("world"),
  tailLog: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({ servers: {}, guilds: {} }),
}));

import * as serverAccess from "../../src/core/utils/server/serverAccess.js";
import { loadWhitelist, invalidateWhitelistCache } from "../../src/core/utils/minecraft/whitelist.js";
import { buildLeaderboard, invalidateAllStatsCache } from "../../src/core/utils/minecraft/statUtils.js";
import { initServers, getServerInstance, getFirstInstance } from "../../src/core/utils/server/server.js";
import type { ServerInstance } from "../../src/core/utils/server/server.js";

function makeServer(id = "survival"): ServerInstance {
  return { id, config: { id, useRcon: false } } as unknown as ServerInstance;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(serverAccess.readWhitelist).mockReset().mockResolvedValue([
    { name: "Alice", uuid: "u1" },
  ] as never);
  invalidateWhitelistCache();
  invalidateAllStatsCache();
});

// ── C-02 ───────────────────────────────────────────────────────────────────

describe("whitelist cache invalidation (C-02)", () => {
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

// ── H-05 ───────────────────────────────────────────────────────────────────

describe("buildLeaderboard never deletes stats (H-05)", () => {
  it("skips UUIDs missing from the whitelist without calling deleteStatsFile", async () => {
    const srv = makeServer();
    // u-orphan is in stats but not on the whitelist
    const result = await buildLeaderboard("deaths", { server: srv });
    expect(serverAccess.deleteStatsFile).not.toHaveBeenCalled();
    // Only the whitelisted player appears
    expect(result.entries.map((e) => e.name)).toEqual(["Alice"]);
  });
});

// ── H-01 ───────────────────────────────────────────────────────────────────

describe("strict server instance lookup (H-01)", () => {
  it("returns null for an unknown ID even when instances exist", () => {
    initServers({
      survival: { id: "survival", useRcon: false } as never,
    });
    expect(getServerInstance("survvial")).toBeNull(); // typo must NOT fall back
    expect(getServerInstance("survival")).not.toBeNull();
  });

  it("getFirstInstance provides the explicit fallback", () => {
    initServers({
      survival: { id: "survival", useRcon: false } as never,
    });
    expect(getFirstInstance()).not.toBeNull();
    expect(getFirstInstance()!.id).toBe("survival");
  });
});

// ── M-12 ───────────────────────────────────────────────────────────────────

describe("daily give() item prefixing (M-12)", () => {
  it("prefixes bare IDs and leaves namespaced IDs untouched", async () => {
    const { give } = await import(
      "../../src/core/utils/minecraft/rewards.js"
    );
    const send = vi.fn().mockResolvedValue({ kind: "sent", via: "screen" });
    const srv = {
      id: "s",
      config: { id: "s", apiUrl: "http://w:3030", apiKey: "k" },
      send,
    } as unknown as ServerInstance;

    await give(srv, "Steve", { item: "diamond", amount: 2 });
    expect(send).toHaveBeenLastCalledWith("give Steve minecraft:diamond 2");

    await give(srv, "Steve", { item: "create:brass_ingot", amount: 1 });
    expect(send).toHaveBeenLastCalledWith("give Steve create:brass_ingot 1");
  });

  it("fails the claim when the console does not confirm the give (M-11)", async () => {
    const { give } = await import(
      "../../src/core/utils/minecraft/rewards.js"
    );
    const send = vi.fn();
    const srv = {
      id: "s",
      config: { id: "s", apiUrl: "http://w:3030", apiKey: "k" },
      send,
    } as unknown as ServerInstance;

    send.mockResolvedValue({
      kind: "delivered",
      output: "Unknown item 'minecraft:not_an_item'",
    });
    expect(await give(srv, "Steve", { item: "not_an_item" })).toBe(false);

    send.mockResolvedValue({
      kind: "delivered",
      output: "Gave 1 [Diamond] to Steve",
    });
    expect(await give(srv, "Steve", { item: "diamond" })).toBe(true);

    send.mockResolvedValue({
      kind: "unreachable",
      reason: "wrapper-down",
      detail: "x",
    });
    expect(await give(srv, "Steve", { item: "diamond" })).toBe(false);
  });
});
