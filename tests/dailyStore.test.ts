/**
 * dailyStore v2 — per-server claim persistence.
 *
 * Covers the v1 → v2 migration (flat userId map → servers keyed store),
 * v2 passthrough, and the lazy per-server claim maps.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/core/utils/utils.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
  loadJson: vi.fn(),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

// The migration resolves its target server from the configured server list
// (dynamic import inside loadClaimedStore — vi.mock intercepts it too).
vi.mock("../src/core/config.js", () => ({
  getServerIds: vi.fn().mockReturnValue(["survival", "creative"]),
}));

import { kvGet, kvSet } from "../src/core/db/kv.js";
import { closeDbForTesting } from "../src/core/db/index.js";
import { getServerIds } from "../src/core/config.js";
import { log } from "../src/core/utils/logger.js";
import {
  loadClaimedStore,
  getServerClaims,
  saveClaimedStore,
} from "../src/core/utils/dailyStore.js";

const record = (lastClaim: number) => ({
  lastClaim,
  currentStreak: 1,
  bonusStreak: 1,
  longestStreak: 1,
  rewards: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  closeDbForTesting(); // fresh in-memory DB per test
  vi.mocked(getServerIds).mockReturnValue(["survival", "creative"]);
});

describe("loadClaimedStore", () => {
  it("passes a v2 store through untouched (no migration, no warning)", async () => {
    const store = {
      version: 2,
      servers: { survival: { u1: record(123) } },
    };
    kvSet("claimedDaily", store);

    const loaded = await loadClaimedStore();
    expect(loaded).toEqual(store);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("returns a fresh empty v2 store when nothing is stored", async () => {
    const loaded = await loadClaimedStore();
    expect(loaded).toEqual({ version: 2, servers: {} });
  });

  it("migrates a legacy v1 map under the first configured server and persists once", async () => {
    // A pre-v2 flat map — exactly what the legacy importer stores verbatim
    // when upgrading an ancient claimedDaily.json.
    kvSet("claimedDaily", {
      u1: record(111),
      u2: record(222),
    });

    const loaded = await loadClaimedStore();

    expect(loaded.version).toBe(2);
    expect(Object.keys(loaded.servers)).toEqual(["survival"]);
    expect(loaded.servers["survival"]!["u1"]!.lastClaim).toBe(111);
    expect(loaded.servers["survival"]!["u2"]!.lastClaim).toBe(222);

    // Persisted so the migration never re-runs
    const persisted = kvGet<{ version: number }>("claimedDaily");
    expect(persisted?.version).toBe(2);

    expect(log.warn).toHaveBeenCalledWith(
      "daily",
      expect.stringContaining("per-server"),
    );
  });

  it('falls back to "default" when no servers are configured', async () => {
    vi.mocked(getServerIds).mockReturnValue([]);
    kvSet("claimedDaily", { u1: record(1) });

    const loaded = await loadClaimedStore();
    expect(Object.keys(loaded.servers)).toEqual(["default"]);
  });
});

describe("getServerClaims", () => {
  it("creates the per-server map lazily and returns the same reference", () => {
    const store = { version: 2 as const, servers: {} };
    const claims = getServerClaims(store, "survival");
    expect(claims).toEqual({});

    claims["u1"] = record(9) as never;
    expect(store.servers["survival"]!["u1"]!.lastClaim).toBe(9);
    expect(getServerClaims(store, "survival")).toBe(claims);
  });

  it("keeps servers isolated from each other", () => {
    const store = { version: 2 as const, servers: {} };
    getServerClaims(store, "a")["u1"] = record(1) as never;
    getServerClaims(store, "b")["u1"] = record(2) as never;

    expect(store.servers["a"]!["u1"]!.lastClaim).toBe(1);
    expect(store.servers["b"]!["u1"]!.lastClaim).toBe(2);
  });
});

describe("saveClaimedStore", () => {
  it('writes the whole store to kv_store["claimedDaily"]', async () => {
    const store = { version: 2 as const, servers: {} };
    await saveClaimedStore(store);
    expect(kvGet("claimedDaily")).toEqual(store);
  });
});
