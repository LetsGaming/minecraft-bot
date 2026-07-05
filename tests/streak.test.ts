/**
 * streak.test.ts — /streak command execute logic
 * Tests getStreakData and getNextBonusStreak via mocked loadJson.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/common/utils/utils.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
  loadJson: vi.fn().mockResolvedValue({}),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/bot/utils/embedUtils.js", () => ({
  createErrorEmbed: vi.fn().mockReturnValue({ type: "error-embed" }),
}));

vi.mock("../src/bot/utils/guildRouter.js", () => ({
  resolveServer: vi.fn().mockReturnValue({ id: "main" }),
}));

import { loadJson } from "../src/common/utils/utils.js";
import { execute } from "../src/bot/commands/connection/daily/streak.js";
import type { ChatInputCommandInteraction } from "discord.js";

function makeInteraction(userId = "user1"): ChatInputCommandInteraction {
  return {
    user: { id: userId },
    commandName: "streak",
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue({}),
    deferred: false,
    replied: false,
  } as unknown as ChatInputCommandInteraction;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadJson).mockResolvedValue({});
});

describe("streak execute", () => {
  it("replies with an error embed when user has no claim data", async () => {
    vi.mocked(loadJson).mockResolvedValue({}); // empty claimedDaily
    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ embeds: expect.any(Array) }),
    );
  });

  it("replies with streak info when user has data and no rewards config", async () => {
    vi.mocked(loadJson)
      .mockResolvedValueOnce({
        version: 2,
        servers: {
          main: {
            user1: { currentStreak: 7, longestStreak: 14, bonusStreak: 7 },
          },
        },
      })
      .mockResolvedValueOnce({}); // no dailyRewards config

    const interaction = makeInteraction();
    await execute(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining("7"),
    );
  });

  it("includes next bonus streak when rewards config has a higher milestone", async () => {
    vi.mocked(loadJson)
      .mockResolvedValueOnce({
        version: 2,
        servers: {
          main: {
            user1: { currentStreak: 5, longestStreak: 5, bonusStreak: 5 },
          },
        },
      })
      .mockResolvedValueOnce({
        streakBonuses: { "7": "bonus_item", "14": "better_bonus" },
      });

    const interaction = makeInteraction();
    await execute(interaction);
    // Should mention "7 days" as the next bonus streak
    const editReplyArg = vi.mocked(interaction.editReply).mock
      .calls[0]![0] as string;
    expect(editReplyArg).toContain("7 days");
  });

  it("shows N/A when all bonuses are already surpassed", async () => {
    vi.mocked(loadJson)
      .mockResolvedValueOnce({
        version: 2,
        servers: {
          main: {
            user1: { currentStreak: 100, longestStreak: 100, bonusStreak: 100 },
          },
        },
      })
      .mockResolvedValueOnce({
        streakBonuses: { "7": "item1", "14": "item2" },
      });

    const interaction = makeInteraction();
    await execute(interaction);
    const editReplyArg = vi.mocked(interaction.editReply).mock
      .calls[0]![0] as string;
    expect(editReplyArg).toContain("N/A");
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
