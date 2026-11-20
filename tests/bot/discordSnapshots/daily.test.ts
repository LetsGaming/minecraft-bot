/**
 * Snapshots of `/daily` replies (claimed, a lucky bonus, queued while offline, cooldown,
 * not linked) through the real command, middleware and embed builders, in
 * English and German. Stores and delivery are faked.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import {
  LANGUAGES,
  NOW,
  SNAPSHOT_CONFIG,
  fixturePath,
  recordingInteraction,
  stringify,
  type Language,
} from "./render.js";

vi.mock("../../../src/core/config.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadConfig: () => SNAPSHOT_CONFIG,
}));
vi.mock("../../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../../src/bot/utils/guild/guildRouter.js", () => ({
  resolveServer: vi.fn(() => ({ id: "smp", config: { id: "smp" }, getMinecraftVersion: async () => null })),
}));
vi.mock("../../../src/bot/utils/hints/followUps.js", () => ({
  attachFollowUpHint: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../src/core/utils/stores/linkStore.js", () => ({
  isLinked: vi.fn(),
  getLinkedAccount: vi.fn(),
}));
vi.mock("../../../src/core/utils/minecraft/playerUtils.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getOnlinePlayers: vi.fn(),
}));
vi.mock("../../../src/core/utils/minecraft/rewards.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  give: vi.fn().mockResolvedValue("delivered"),
}));

const HOUR = 3_600_000;
interface PoolEntry {
  item: string;
  amount: number;
  weight?: number;
  tier?: string;
}
const BASE_POOL = vi.hoisted(() => ({
  default: [{ item: "minecraft:diamond", amount: 3, weight: 1 }] as PoolEntry[],
  streakBonuses: { "6": [{ item: "minecraft:cooked_beef", amount: 16 }] } as Record<string, PoolEntry[]>,
}));
const claims = vi.hoisted(() => ({
  lastClaim: 0,
  bonusChance: 0,
  pool: null as { default: PoolEntry[]; streakBonuses: Record<string, PoolEntry[]> } | null,
}));
vi.mock("../../../src/core/utils/stores/dailyStore.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadDailyRewardsConfig: vi.fn().mockResolvedValue({}),
  loadServerRewardsOverride: vi.fn().mockResolvedValue(null),
  rewardPoolForServer: vi.fn(() => ({
    ...(claims.pool ?? BASE_POOL),
    bonusChance: claims.bonusChance,
  })),
  loadClaimedStore: vi.fn(async () => ({})),
  getServerClaims: vi.fn(() => ({
    "admin-1": {
      lastClaim: claims.lastClaim,
      currentStreak: 5,
      bonusStreak: 5,
      longestStreak: 5,
      rewards: [],
    },
  })),
  saveClaimedStore: vi.fn().mockResolvedValue(undefined),
  loadPendingRewards: vi.fn(async () => ({})),
  savePendingRewards: vi.fn().mockResolvedValue(undefined),
  getServerPending: vi.fn(() => ({})),
}));

import { closeDbForTesting } from "../../../src/core/db/index.js";
import { getLinkedAccount } from "../../../src/core/utils/stores/linkStore.js";
import { getOnlinePlayers } from "../../../src/core/utils/minecraft/playerUtils.js";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterAll(() => {
  vi.useRealTimers();
});

describe("Discord snapshots: /daily", () => {
  it("claimed, queued, cooldown and not linked", async () => {
    const { execute } = await import("../../../src/bot/commands/connection/daily/daily.js");
    const run = async (language: Language) => {
      closeDbForTesting();
      const { interaction, sent } = recordingInteraction(language, { commandName: "daily" });
      await execute(interaction as never);
      return sent;
    };
    let random: ReturnType<typeof vi.spyOn> | undefined;
    const cases: Record<string, () => void> = {
      "claimed, online": () => {
        vi.mocked(getLinkedAccount).mockResolvedValue("ikarus_77");
        vi.mocked(getOnlinePlayers).mockResolvedValue(["ikarus_77"]);
        claims.lastClaim = NOW - 25 * HOUR;
      },
      "claimed with a lucky bonus": () => {
        vi.mocked(getLinkedAccount).mockResolvedValue("ikarus_77");
        vi.mocked(getOnlinePlayers).mockResolvedValue(["ikarus_77"]);
        claims.lastClaim = NOW - 25 * HOUR;
        claims.bonusChance = 100;
      },
      "claimed, offline so queued": () => {
        claims.bonusChance = 0;
        vi.mocked(getLinkedAccount).mockResolvedValue("ikarus_77");
        vi.mocked(getOnlinePlayers).mockResolvedValue([]);
        claims.lastClaim = NOW - 25 * HOUR;
      },
      "claimed, epic stack with a lucky bonus and a milestone": () => {
        vi.mocked(getLinkedAccount).mockResolvedValue("ikarus_77");
        vi.mocked(getOnlinePlayers).mockResolvedValue(["ikarus_77"]);
        claims.lastClaim = NOW - 25 * HOUR;
        claims.bonusChance = 100;
        claims.pool = {
          default: [
            { item: "minecraft:oak_log", amount: 128, weight: 1, tier: "epic" },
            { item: "minecraft:iron_ingot", amount: 4, weight: 1, tier: "common" },
          ],
          streakBonuses: BASE_POOL.streakBonuses,
        };
        // main tier, main entry, bonus-chance roll, bonus tier, bonus entry
        random = vi.spyOn(Math, "random");
        for (const value of [0.9, 0, 0, 0.1, 0]) random.mockReturnValueOnce(value);
      },
      "claimed, dirt roll": () => {
        vi.mocked(getLinkedAccount).mockResolvedValue("ikarus_77");
        vi.mocked(getOnlinePlayers).mockResolvedValue(["ikarus_77"]);
        claims.lastClaim = NOW - 25 * HOUR;
        claims.pool = { default: [{ item: "minecraft:stick", amount: 1, weight: 1, tier: "dirt" }], streakBonuses: {} };
      },
      "claimed, a stack and a remainder": () => {
        vi.mocked(getLinkedAccount).mockResolvedValue("ikarus_77");
        vi.mocked(getOnlinePlayers).mockResolvedValue(["ikarus_77"]);
        claims.lastClaim = NOW - 25 * HOUR;
        claims.pool = {
          default: [{ item: "minecraft:cobblestone", amount: 84, weight: 1, tier: "rare" }],
          streakBonuses: {},
        };
      },
      "claimed, offline so queued, epic with a milestone": () => {
        vi.mocked(getLinkedAccount).mockResolvedValue("ikarus_77");
        vi.mocked(getOnlinePlayers).mockResolvedValue([]);
        claims.lastClaim = NOW - 25 * HOUR;
        claims.pool = {
          default: [{ item: "minecraft:oak_log", amount: 128, weight: 1, tier: "epic" }],
          streakBonuses: BASE_POOL.streakBonuses,
        };
      },
      cooldown: () => {
        vi.mocked(getLinkedAccount).mockResolvedValue("ikarus_77");
        claims.lastClaim = NOW - 9 * HOUR;
      },
      "not linked": () => {
        vi.mocked(getLinkedAccount).mockResolvedValue(null);
      },
    };
    const out: Record<string, unknown> = {};
    for (const [name, arrange] of Object.entries(cases)) {
      const perLanguage: Record<string, unknown> = {};
      for (const language of LANGUAGES) {
        claims.pool = null;
        claims.bonusChance = 0;
        arrange();
        perLanguage[language] = await run(language);
        random?.mockRestore();
        random = undefined;
      }
      out[name] = perLanguage;
    }
    await expect(stringify(out)).toMatchFileSnapshot(fixturePath("daily"));
  });
});
