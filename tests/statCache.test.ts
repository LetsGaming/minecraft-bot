/**
 * Tests for the loadAllStats TTL cache in statUtils.
 *
 * loadAllStats delegates all I/O to serverAccess (listStatsUuids + readStats),
 * so this test mocks serverAccess — not fs or loadJson — to control what the
 * cache layer sees.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Top-level mocks ────────────────────────────────────────────────────────

vi.mock("../src/utils/serverAccess.js", () => ({
  listStatsUuids: vi.fn().mockResolvedValue(["abc123", "def456"]),
  readStats: vi.fn().mockResolvedValue({ stats: {} }),
}));

vi.mock("../src/utils/server.js", () => ({
  getServerInstance: vi.fn().mockReturnValue({
    config: { id: "default", serverDir: "/fake/server" },
    // minimal ServerInstance shape loadAllStats requires
  }),
}));

import {
  loadAllStats,
  invalidateAllStatsCache,
} from "../src/utils/statUtils.js";
import * as serverAccess from "../src/utils/serverAccess.js";

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
});
