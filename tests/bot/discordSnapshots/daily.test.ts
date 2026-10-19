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
  resolveServer: vi.fn(() => ({ id: "smp", config: { id: "smp" } })),
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
  give: vi.fn().mockResolvedValue(true),
}));

const HOUR = 3_600_000;
const claims = vi.hoisted(() => ({ lastClaim: 0, bonusChance: 0 }));
vi.mock("../../../src/core/utils/stores/dailyStore.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadDailyRewardsConfig: vi.fn().mockResolvedValue({}),
  loadServerRewardsOverride: vi.fn().mockResolvedValue(null),
  rewardPoolForServer: vi.fn(() => ({
    default: [{ item: "minecraft:diamond", amount: 3, weight: 1 }],
    streakBonuses: { "6": [{ item: "minecraft:cooked_beef", amount: 16 }] },
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
        arrange();
        perLanguage[language] = await run(language);
      }
      out[name] = perLanguage;
    }
    await expect(stringify(out)).toMatchFileSnapshot(fixturePath("daily"));
  });
});
