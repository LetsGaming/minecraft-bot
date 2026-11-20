/**
 * Snapshots of `/daily-history` through the real command and embed builders, in English and
 * German: a full claim (main, lucky bonus, milestone), a claim with only a main reward, and a
 * claim from before tiers existed. Stores are faked.
 */
import { describe, it, expect, vi } from "vitest";
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

const HOUR = 3_600_000;
const wayfinder = "wayfinder_armor_trim_smithing_template";

const history = vi.hoisted(() => ({
  rewards: [] as Array<{
    date: number;
    streak: number;
    items: Array<{ item: string; amount: number; tier?: string; weight?: number }>;
  }>,
}));

vi.mock("../../../src/core/utils/stores/dailyStore.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadClaimedStore: vi.fn(async () => ({})),
  getServerClaims: vi.fn(() => ({
    "admin-1": {
      lastClaim: 0,
      currentStreak: 1,
      bonusStreak: 1,
      longestStreak: 1,
      rewards: history.rewards,
    },
  })),
}));

async function run(language: Language): Promise<unknown> {
  const { execute } = await import("../../../src/bot/commands/connection/daily/dailyHistory.js");
  const { interaction, sent } = recordingInteraction(language, { commandName: "daily-history" });
  await execute(interaction as never);
  return sent;
}

describe("Discord snapshots: /daily-history", () => {
  it("shows the main reward first and the lucky bonus and milestone under it", async () => {
    history.rewards = [
      // Oldest first, the command shows the newest on top.
      { date: NOW - 3 * 24 * HOUR, streak: 1, items: [{ item: "minecraft:cooked_beef", amount: 16, weight: 2 }] },
      {
        date: NOW - 2 * 24 * HOUR,
        streak: 5,
        items: [{ item: "minecraft:oak_log", amount: 64, tier: "rare", weight: 1 }],
      },
      {
        date: NOW - 24 * HOUR,
        streak: 6,
        items: [
          { item: "minecraft:oak_log", amount: 128, tier: "epic", weight: 1 },
          { item: "minecraft:iron_ingot", amount: 4, tier: "common", weight: 1 },
          { item: "minecraft:cooked_beef", amount: 16 },
          { item: "minecraft:diamond_block", amount: 2 },
        ],
      },
    ];
    const out: Record<string, unknown> = {};
    for (const language of LANGUAGES) out[language] = await run(language);
    await expect(stringify(out)).toMatchFileSnapshot(fixturePath("history"));
  });

  it("keeps a full page of the longest claims under the description limit", async () => {
    const longest = {
      streak: 38,
      items: [
        { item: `minecraft:${wayfinder}`, amount: 1, tier: "legendary", weight: 1 },
        { item: `minecraft:${wayfinder}`, amount: 1, tier: "legendary", weight: 1 },
        { item: "minecraft:sentry_armor_trim_smithing_template", amount: 2 },
        { item: "minecraft:ward_armor_trim_smithing_template", amount: 2 },
        { item: "minecraft:netherite_upgrade_smithing_template", amount: 2 },
      ],
    };
    history.rewards = Array.from({ length: 30 }, (_, n) => ({ ...longest, date: NOW - n * 24 * HOUR }));
    for (const language of LANGUAGES) {
      const sent = (await run(language)) as Array<{ embeds?: Array<{ description?: string }> }>;
      const description = sent.flatMap((m) => m.embeds ?? []).map((e) => e.description ?? "")[0] ?? "";
      expect(description.length).toBeGreaterThan(0);
      expect(description.length).toBeLessThan(4096);
    }
  });
});
