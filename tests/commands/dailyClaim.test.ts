/**
 * Characterisation of the daily claim service: roll, streak, bonus, offline
 * queue and its cap, online delivery, undelivered items, and rollback by
 * (discordId, queuedAt) identity when a concurrent claim wins.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/core/utils/stores/linkUtils.js", () => ({
  isLinked: vi.fn(),
  getLinkedAccount: vi.fn(),
}));
vi.mock("../../src/core/utils/minecraft/playerUtils.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getOnlinePlayers: vi.fn(),
}));
vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({ language: "en", guilds: {} }),
  getServerIds: vi.fn().mockReturnValue(["smp"]),
}));

const pool = vi.hoisted(() => ({
  cfg: {} as Record<string, unknown>,
}));
vi.mock("../../src/core/utils/stores/rewardsConfig.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadDailyRewardsConfig: vi.fn(async () => pool.cfg),
  loadServerRewardsOverride: vi.fn(async () => undefined),
}));

import { kvGet, kvSet } from "../../src/core/db/kv.js";
import { closeDbForTesting } from "../../src/core/db/index.js";
import { getLinkedAccount } from "../../src/core/utils/stores/linkUtils.js";
import { getOnlinePlayers } from "../../src/core/utils/minecraft/playerUtils.js";
import {
  loadPendingRewards,
  getServerPending,
  loadClaimedStore,
  updateClaimedStore,
  getServerClaims,
  MAX_PENDING_PER_PLAYER,
} from "../../src/core/utils/stores/dailyStore.js";
import { claimDaily, rollClaim } from "../../src/core/utils/minecraft/dailyClaim.js";
import { DAILY_COOLDOWN_MS, STREAK_GRACE_MS } from "../../src/core/utils/minecraft/rewards.js";
import type { ServerInstance } from "../../src/core/utils/server/server.js";

const NOW = 10 * DAILY_COOLDOWN_MS;
const DIAMOND = { item: "minecraft:diamond", amount: 1, weight: 1 };

function fakeServer(give: (cmd: string) => unknown = () => ({ kind: "delivered", output: "Gave 1 [x] to Steve" })) {
  const send = vi.fn(async (cmd: string) => give(cmd));
  return { id: "smp", config: { apiUrl: "http://w:3030", apiKey: "k" }, send } as unknown as
    ServerInstance & { send: ReturnType<typeof vi.fn> };
}

function seedClaim(overrides: Record<string, unknown> = {}) {
  kvSet("claimedDaily", {
    version: 2,
    servers: {
      smp: {
        u1: {
          lastClaim: NOW - 25 * 3_600_000,
          currentStreak: 3,
          bonusStreak: 3,
          longestStreak: 5,
          rewards: [],
          ...overrides,
        },
      },
    },
  });
}

async function storedClaim() {
  return getServerClaims(await loadClaimedStore(), "smp")["u1"]!;
}

beforeEach(() => {
  vi.clearAllMocks();
  closeDbForTesting();
  pool.cfg = { default: [DIAMOND], streakBonuses: {} };
  vi.mocked(getLinkedAccount).mockResolvedValue("Steve");
  vi.mocked(getOnlinePlayers).mockResolvedValue(["Steve"]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rollClaim", () => {
  it("continues the streak inside the grace window and carries the milestone bonus", () => {
    const bonus = { item: "minecraft:emerald", amount: 4 };
    const roll = rollClaim(
      { default: [DIAMOND], streakBonuses: { "4": [bonus] } },
      { lastClaim: 0, currentStreak: 3, bonusStreak: 3, longestStreak: 3 },
      DAILY_COOLDOWN_MS + 1,
    );
    expect(roll.currentStreak).toBe(4);
    expect(roll.bonusStreak).toBe(4);
    expect(roll.lostStreak).toBe(0);
    expect(roll.granted.streakBonus).toEqual([bonus]);
    expect(roll.items).toEqual([DIAMOND, bonus]);
  });

  it("restarts the streak after the grace window and reports the lost streak", () => {
    const roll = rollClaim(
      { default: [DIAMOND] },
      { lastClaim: 1, currentStreak: 9, bonusStreak: 9, longestStreak: 9 },
      STREAK_GRACE_MS + 2,
    );
    expect(roll.currentStreak).toBe(1);
    expect(roll.lostStreak).toBe(9);
    expect(roll.longestStreak).toBe(9);
  });

  it("rolls the random bonus from bonusChance as a percentage", () => {
    const base = { lastClaim: 0, currentStreak: 0, bonusStreak: 0, longestStreak: 0 };
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(rollClaim({ default: [DIAMOND], bonusChance: 60 }, base, NOW).granted.randomBonus).toEqual(DIAMOND);
    expect(rollClaim({ default: [DIAMOND], bonusChance: 40 }, base, NOW).granted.randomBonus).toBeNull();
    expect(rollClaim({ default: [DIAMOND] }, base, NOW).granted.randomBonus).toBeNull();
  });
});

describe("claimDaily outcomes", () => {
  it("reports an unlinked user", async () => {
    vi.mocked(getLinkedAccount).mockResolvedValue(null);
    expect(await claimDaily(fakeServer(), "u1", NOW)).toEqual({ kind: "not-linked" });
  });

  it("reports an empty reward pool", async () => {
    pool.cfg = { default: [] };
    expect(await claimDaily(fakeServer(), "u1", NOW)).toEqual({ kind: "no-rewards" });
  });

  it("reports the cooldown without writing anything", async () => {
    seedClaim({ lastClaim: NOW - 3_600_000 });
    const server = fakeServer();
    const outcome = await claimDaily(server, "u1", NOW);
    expect(outcome).toMatchObject({ kind: "cooldown", currentStreak: 3 });
    expect(server.send).not.toHaveBeenCalled();
  });

  it("delivers online, advances the streak and records the claim", async () => {
    seedClaim();
    const server = fakeServer();
    const outcome = await claimDaily(server, "u1", NOW);
    expect(outcome).toMatchObject({ kind: "claimed", player: "Steve", currentStreak: 4, claimedAt: NOW });
    expect(server.send).toHaveBeenCalledTimes(1);
    const saved = await storedClaim();
    expect(saved).toMatchObject({ lastClaim: NOW, currentStreak: 4, bonusStreak: 4, longestStreak: 5 });
    expect(saved.rewards).toHaveLength(1);
  });

  it("queues the whole roll for an offline player and still consumes the claim", async () => {
    seedClaim();
    vi.mocked(getOnlinePlayers).mockResolvedValue([]);
    const server = fakeServer();
    const outcome = await claimDaily(server, "u1", NOW);
    expect(outcome).toMatchObject({
      kind: "queued",
      partial: false,
      queued: 1,
      max: MAX_PENDING_PER_PLAYER,
      rewards: [DIAMOND],
    });
    expect(server.send).not.toHaveBeenCalled();
    const queue = getServerPending(await loadPendingRewards(), "smp")["steve"]!;
    expect(queue).toEqual([{ discordId: "u1", items: [DIAMOND], queuedAt: NOW }]);
    expect((await storedClaim()).lastClaim).toBe(NOW);
  });

  it("rejects an offline claim at the pending cap without consuming the cooldown", async () => {
    seedClaim();
    vi.mocked(getOnlinePlayers).mockResolvedValue([]);
    const entries = Array.from({ length: MAX_PENDING_PER_PLAYER }, (_, i) => ({
      discordId: "u1",
      items: [DIAMOND],
      queuedAt: i + 1,
    }));
    kvSet("pendingRewards", { version: 1, servers: { smp: { steve: entries } } });
    const before = (await storedClaim()).lastClaim;

    expect(await claimDaily(fakeServer(), "u1", NOW)).toEqual({
      kind: "queue-full",
      max: MAX_PENDING_PER_PLAYER,
    });
    expect((await storedClaim()).lastClaim).toBe(before);
    expect(getServerPending(await loadPendingRewards(), "smp")["steve"]).toHaveLength(MAX_PENDING_PER_PLAYER);
  });

  it("queues only the items that could not be delivered, beyond the cap", async () => {
    seedClaim();
    pool.cfg = { default: [DIAMOND], streakBonuses: { "4": [{ item: "minecraft:emerald", amount: 2 }] } };
    const entries = Array.from({ length: MAX_PENDING_PER_PLAYER }, (_, i) => ({
      discordId: "u1",
      items: [DIAMOND],
      queuedAt: i + 1,
    }));
    kvSet("pendingRewards", { version: 1, servers: { smp: { steve: entries } } });
    const server = fakeServer((cmd) =>
      cmd.includes("emerald")
        ? { kind: "delivered", output: "No item was found" }
        : { kind: "delivered", output: "Gave 1 [Diamond] to Steve" },
    );

    const outcome = await claimDaily(server, "u1", NOW);
    expect(outcome).toMatchObject({
      kind: "queued",
      partial: true,
      rewards: [{ item: "minecraft:emerald", amount: 2 }],
      queued: MAX_PENDING_PER_PLAYER + 1,
    });
    expect((await storedClaim()).lastClaim).toBe(NOW);
  });

  it("rolls back the queued entry by identity when a concurrent claim wins", async () => {
    seedClaim();
    vi.mocked(getOnlinePlayers).mockResolvedValue([]);
    const other = { discordId: "u2", items: [DIAMOND], queuedAt: NOW };
    kvSet("pendingRewards", { version: 1, servers: { smp: { steve: [other] } } });

    // The competing claim lands while the online lookup is in flight.
    vi.mocked(getOnlinePlayers).mockImplementation(async () => {
      await updateClaimedStore((store) => {
        getServerClaims(store, "smp")["u1"]!.lastClaim = NOW - 1000;
      });
      return [];
    });

    expect(await claimDaily(fakeServer(), "u1", NOW)).toMatchObject({ kind: "already-claimed", now: NOW });
    // Only this user's entry is removed; the other user's entry at the same
    // timestamp stays.
    const queue = getServerPending(await loadPendingRewards(), "smp")["steve"]!;
    expect(queue).toEqual([other]);
  });

  it("does not deliver anything when a concurrent claim wins an online claim", async () => {
    seedClaim();
    vi.mocked(getOnlinePlayers).mockImplementation(async () => {
      await updateClaimedStore((store) => {
        getServerClaims(store, "smp")["u1"]!.lastClaim = NOW - 1000;
      });
      return ["Steve"];
    });
    const server = fakeServer();
    expect(await claimDaily(server, "u1", NOW)).toMatchObject({ kind: "already-claimed" });
    expect(server.send).not.toHaveBeenCalled();
    expect(kvGet("pendingRewards")).toBeNull();
  });
});
