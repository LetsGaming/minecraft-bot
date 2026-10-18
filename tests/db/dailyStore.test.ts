/**
 * dailyStore v2 — per-server claim persistence.
 *
 * Covers the v1 → v2 migration (flat userId map → servers keyed store),
 * v2 passthrough, and the lazy per-server claim maps.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/core/utils/jsonStore.js", () => ({
  loadJson: vi.fn(),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/core/utils/paths.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
}));

// The migration resolves its target server from the configured server list
// (dynamic import inside loadClaimedStore — vi.mock intercepts it too).
vi.mock("../../src/core/config.js", () => ({
  getServerIds: vi.fn().mockReturnValue(["survival", "creative"]),
}));

import { kvGet, kvSet } from "../../src/core/db/kv.js";
import { closeDbForTesting } from "../../src/core/db/index.js";
import { getServerIds } from "../../src/core/config.js";
import { log } from "../../src/core/utils/logger.js";
import {
  loadClaimedStore,
  getServerClaims,
  enqueuePending,
  removePending,
  takePending,
  requeuePending,
  hasPending,
  loadPendingRewards,
  getServerPending,
  updatePendingRewards,
  MAX_PENDING_PER_PLAYER,
} from "../../src/core/utils/stores/dailyStore.js";

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

describe("updateClaimedStore (AUD-005)", () => {
  it("applies each change to the current store, not a stale copy", async () => {
    const { loadClaimedStore, updateClaimedStore, getServerClaims } = await import(
      "../../src/core/utils/stores/dailyStore.js"
    );
    kvSet("claimedDaily", { version: 2, servers: {} });
    const stale = await loadClaimedStore();
    await updateClaimedStore((s) => {
      getServerClaims(s, "survival")["a"] = {
        lastClaim: 1, currentStreak: 1, bonusStreak: 1, longestStreak: 1, rewards: [],
      };
    });
    await updateClaimedStore((s) => {
      getServerClaims(s, "survival")["b"] = {
        lastClaim: 2, currentStreak: 1, bonusStreak: 1, longestStreak: 1, rewards: [],
      };
    });
    const claims = getServerClaims(await loadClaimedStore(), "survival");
    expect(Object.keys(claims).sort()).toEqual(["a", "b"]);
    expect(stale.servers).toEqual({});
  });

  it("writes nothing when fn throws", async () => {
    const { loadClaimedStore, updateClaimedStore } = await import(
      "../../src/core/utils/stores/dailyStore.js"
    );
    kvSet("claimedDaily", { version: 2, servers: {} });
    await expect(
      updateClaimedStore((s) => {
        s.servers["x"] = {};
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");
    expect((await loadClaimedStore()).servers).toEqual({});
  });
});

describe("pending reward queue helpers", () => {
  const entry = (queuedAt: number, discordId = "u1") => ({
    discordId,
    items: [{ item: "diamond", amount: 1 }],
    queuedAt,
  });

  it("enqueues under the lowercased player name and reports the queue length", async () => {
    expect(await enqueuePending("smp", "Steve", entry(1))).toBe(1);
    expect(await enqueuePending("smp", "STEVE", entry(2))).toBe(2);
    const queue = getServerPending(await loadPendingRewards(), "smp");
    expect(queue["steve"]).toHaveLength(2);
    expect(kvGet("pendingRewards")).toEqual({
      version: 1,
      servers: { smp: { steve: [entry(1), entry(2)] } },
    });
  });

  it("refuses past the cap without writing", async () => {
    for (let n = 0; n < MAX_PENDING_PER_PLAYER; n++) {
      await enqueuePending("smp", "steve", entry(n), { cap: MAX_PENDING_PER_PLAYER });
    }
    expect(
      await enqueuePending("smp", "steve", entry(99), { cap: MAX_PENDING_PER_PLAYER }),
    ).toBeNull();
    expect(getServerPending(await loadPendingRewards(), "smp")["steve"]).toHaveLength(
      MAX_PENDING_PER_PLAYER,
    );
  });

  it("removes selected entries and drops the key once the queue is empty", async () => {
    await enqueuePending("smp", "steve", entry(1, "u1"));
    await enqueuePending("smp", "steve", entry(2, "u2"));
    await removePending("smp", "Steve", (e) => e.discordId === "u1");
    expect(getServerPending(await loadPendingRewards(), "smp")["steve"]).toEqual([
      entry(2, "u2"),
    ]);
    await removePending("smp", "steve", () => true);
    expect(getServerPending(await loadPendingRewards(), "smp")["steve"]).toBeUndefined();
  });

  it("takes everything out in one step and requeues ahead of newer entries", async () => {
    await enqueuePending("smp", "steve", entry(1));
    await enqueuePending("smp", "steve", entry(2));
    const taken = await takePending("smp", "STEVE");
    expect(taken.map((e) => e.queuedAt)).toEqual([1, 2]);
    expect(await hasPending("smp", "steve")).toBe(false);
    expect(await takePending("smp", "steve")).toEqual([]);

    await enqueuePending("smp", "steve", entry(3));
    await requeuePending("smp", "steve", taken);
    expect(
      getServerPending(await loadPendingRewards(), "smp")["steve"]!.map((e) => e.queuedAt),
    ).toEqual([1, 2, 3]);
    expect(await hasPending("smp", "Steve")).toBe(true);
  });

  it("concurrent enqueues do not lose entries", async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, n) => enqueuePending("smp", "steve", entry(n))),
    );
    expect(await takePending("smp", "steve")).toHaveLength(20);
  });

  it.each(["__proto__", "constructor", "toString", "hasOwnProperty"])(
    "treats the player name %s as an ordinary key",
    async (name) => {
      expect(await enqueuePending("smp", name, entry(1))).toBe(1);
      expect(await hasPending("smp", name)).toBe(true);
      expect(await hasPending("smp", "someoneelse")).toBe(false);
      // A reload from JSON keeps the entry reachable under the same key.
      const persisted = kvGet("pendingRewards");
      kvSet("pendingRewards", JSON.parse(JSON.stringify(persisted)));
      expect(await takePending("smp", name)).toEqual([entry(1)]);
      expect(({} as Record<string, unknown>)["queuedAt"]).toBeUndefined();
    },
  );

  it("updatePendingRewards still sees the stored queue", async () => {
    await enqueuePending("smp", "alex", entry(1));
    const length = await updatePendingRewards(
      (store) => getServerPending(store, "smp")["alex"]!.length,
    );
    expect(length).toBe(1);
  });
});
