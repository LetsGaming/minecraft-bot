/**
 * Tests for the loadAllStats TTL cache in statUtils.
 *
 * loadAllStats delegates all I/O to serverAccess (listStatsUuids + readStats),
 * so this test mocks serverAccess — not fs or loadJson — to control what the
 * cache layer sees.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Top-level mocks ────────────────────────────────────────────────────────

vi.mock("../../src/core/utils/server/serverAccess.js", () => ({
  readUserCache: vi.fn().mockResolvedValue([]),
  // null: simulates a wrapper too old to serve the bulk route, so the
  // existing per-uuid tests below keep exercising that fallback path.
  readAllStats: vi.fn().mockResolvedValue(null),
  listStatsUuids: vi.fn().mockResolvedValue(["abc123", "def456"]),
  readStats: vi.fn().mockResolvedValue({ stats: {} }),
}));

vi.mock("../../src/core/utils/server/server.js", () => ({
  getServerInstance: vi.fn().mockReturnValue({
    config: { id: "default", serverDir: "/fake/server" },
    // minimal ServerInstance shape loadAllStats requires
  }),
  // StatUtils now resolves the implicit fallback via getFirstInstance
  getFirstInstance: vi.fn().mockReturnValue({
    config: { id: "default", serverDir: "/fake/server" },
  }),
}));

import {
  loadAllStats,
  invalidateAllStatsCache,
} from "../../src/core/utils/minecraft/statUtils.js";
import * as serverAccess from "../../src/core/utils/server/serverAccess.js";

beforeEach(() => {
  vi.clearAllMocks();
  invalidateAllStatsCache();
});

afterEach(() => {
  invalidateAllStatsCache();
});

describe("loadAllStats TTL cache", () => {
  it("calls listStatsUuids and readStats on first call", async () => {
    await loadAllStats();

    expect(vi.mocked(serverAccess.listStatsUuids)).toHaveBeenCalledTimes(1);
    // 2 UUIDs → 2 readStats calls
    expect(vi.mocked(serverAccess.readStats)).toHaveBeenCalledTimes(2);
  });

  it("returns cached result within TTL without re-reading files", async () => {
    await loadAllStats();
    const readsAfterFirst = vi.mocked(serverAccess.readStats).mock.calls.length;

    await loadAllStats();

    // No additional reads — served from cache.
    expect(vi.mocked(serverAccess.readStats).mock.calls.length).toBe(
      readsAfterFirst,
    );
  });

  it("re-reads files after cache is invalidated", async () => {
    await loadAllStats();
    const readsAfterFirst = vi.mocked(serverAccess.readStats).mock.calls.length;

    invalidateAllStatsCache();
    await loadAllStats();

    expect(vi.mocked(serverAccess.readStats).mock.calls.length).toBeGreaterThan(
      readsAfterFirst,
    );
  });

  it("uses the bulk route and skips the per-uuid fan-out when the wrapper supports it", async () => {
    vi.mocked(serverAccess.readAllStats).mockResolvedValueOnce({
      abc123: { stats: {} } as never,
    });

    const data = await loadAllStats();

    expect(data).toEqual({ abc123: { stats: {} } });
    expect(vi.mocked(serverAccess.listStatsUuids)).not.toHaveBeenCalled();
    expect(vi.mocked(serverAccess.readStats)).not.toHaveBeenCalled();
  });

  it("falls back to the per-uuid path when the bulk route rejects (older wrapper)", async () => {
    vi.mocked(serverAccess.readAllStats).mockRejectedValueOnce(new Error("404"));

    await loadAllStats();

    expect(vi.mocked(serverAccess.listStatsUuids)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(serverAccess.readStats)).toHaveBeenCalledTimes(2);
  });
});
