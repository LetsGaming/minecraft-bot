/**
 * streak.test.ts — /streak command execute logic
 * Tests getStreakData and getNextBonusStreak — claims seeded into the
 * real in-memory kv store; loadJson only serves dailyRewards.json (the
 * hand-edited file that stays JSON).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/jsonStore.js", () => ({
  loadJson: vi.fn().mockResolvedValue({}),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/core/utils/paths.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
}));


vi.mock("../../src/bot/utils/guild/guildRouter.js", () => ({
  resolveServer: vi.fn().mockReturnValue({ id: "main" }),
}));

import { loadJson } from "../../src/core/utils/jsonStore.js";
import { kvSet } from "../../src/core/db/kv.js";
import { closeDbForTesting } from "../../src/core/db/index.js";
import { execute } from "../../src/bot/commands/connection/daily/streak.js";
import type { ChatInputCommandInteraction } from "discord.js";

function makeInteraction(userId = "user1"): ChatInputCommandInteraction {
  const interaction = {
    user: { id: userId, username: "tester" },
    commandName: "streak",
    deferReply: vi.fn().mockImplementation(async () => {
      interaction.deferred = true;
      interaction.ephemeral = true;
    }),
    editReply: vi.fn().mockResolvedValue({}),
    deferred: false,
    replied: false,
    ephemeral: null as boolean | null,
  };
  return interaction as unknown as ChatInputCommandInteraction;
}

/** Everything the first edited embed says, as one string. */
function repliedText(interaction: ChatInputCommandInteraction): string {
  const payload = vi.mocked(interaction.editReply).mock.calls[0]![0] as {
    embeds: { toJSON(): unknown }[];
  };
  return JSON.stringify(payload.embeds[0]!.toJSON());
}

beforeEach(() => {
  vi.clearAllMocks();
  closeDbForTesting(); // fresh in-memory DB per test
  vi.mocked(loadJson).mockResolvedValue({});
});

describe("streak execute", () => {
  it("replies with an error embed when user has no claim data", async () => {
    vi.mocked(loadJson).mockResolvedValue({}); // empty claimedDaily
    const interaction = makeInteraction();
    await execute(interaction);
    expect(repliedText(interaction)).toContain("/daily");
  });

  it("replies with streak info when user has data and no rewards config", async () => {
    kvSet("claimedDaily", {
      version: 2,
      servers: {
        main: {
          user1: { currentStreak: 7, longestStreak: 14, bonusStreak: 7 },
        },
      },
    });
    vi.mocked(loadJson).mockResolvedValue({}); // no dailyRewards config

    const interaction = makeInteraction();
    await execute(interaction);
    expect(repliedText(interaction)).toContain("7 days");
  });

  it("includes next bonus streak when rewards config has a higher milestone", async () => {
    kvSet("claimedDaily", {
      version: 2,
      servers: {
        main: {
          user1: { currentStreak: 5, longestStreak: 5, bonusStreak: 5 },
        },
      },
    });
    vi.mocked(loadJson).mockResolvedValue({
      streakBonuses: { "7": "bonus_item", "14": "better_bonus" },
    });

    const interaction = makeInteraction();
    await execute(interaction);
    // Should mention "7 days" as the next bonus streak
    expect(repliedText(interaction)).toContain("7 days");
  });

  it("shows N/A when all bonuses are already surpassed", async () => {
    kvSet("claimedDaily", {
      version: 2,
      servers: {
        main: {
          user1: { currentStreak: 100, longestStreak: 100, bonusStreak: 100 },
        },
      },
    });
    vi.mocked(loadJson).mockResolvedValue({
      streakBonuses: { "7": "item1", "14": "item2" },
    });

    const interaction = makeInteraction();
    await execute(interaction);
    expect(repliedText(interaction)).toContain("None");
  });

  it("defers reply as ephemeral", async () => {
    vi.mocked(loadJson).mockResolvedValue({});
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.deferReply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: expect.anything() }),
    );
  });
});
