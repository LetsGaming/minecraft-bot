import { SlashCommandBuilder } from "discord.js";
import {
  loadDailyRewardsConfig,
  loadServerRewardsOverride,
  loadClaimedStore,
  getServerClaims,
  rewardPoolForServer,
} from "@mcbot/core/utils/stores/dailyStore.js";
import { resolveServer } from "../../../utils/guild/guildRouter.js";
import { createEmbed } from "../../../utils/embeds/embedUtils.js";
import { withErrorHandling } from "../../middleware.js";
import { CommandError } from "@mcbot/core/utils/error.js";
import type { StreakData, NextBonusStreak } from "@mcbot/core/types/index.js";

import { t } from "@mcbot/core/utils/i18n.js";
export const data = new SlashCommandBuilder()
  .setName("streak")
  .setDescription("Get information about your daily streak")
  .addStringOption((o) =>
    o
      .setName("server")
      .setDescription("Server to show the streak for")
      .setAutocomplete(true),
  );

export const execute = withErrorHandling(
  async (interaction) => {
    const server = resolveServer(interaction);
    const streakData = await getStreakData(interaction.user.id, server.id);

    if (!streakData) {
      throw new CommandError({
        title: t("streak.noDataTitle"),
        problem: t("streak.noData"),
        recovery: t("streak.noDataRecovery"),
      });
    }

    const { currentStreak, longestStreak, bonusStreak } = streakData;
    const nextBonus = await getNextBonusStreak(bonusStreak, server.id);

    await interaction.editReply({
      embeds: [
        createEmbed({ title: t("streak.title", { server: server.id }) }).addFields(
          { name: t("streak.current"), value: t("streak.days", { count: currentStreak }), inline: true },
          { name: t("streak.longest"), value: t("streak.days", { count: longestStreak }), inline: true },
          {
            name: t("streak.nextBonus"),
            value: nextBonus ? t("streak.days", { count: nextBonus.streak }) : t("streak.na"),
            inline: true,
          },
        ),
      ],
    });
  },
  { ephemeral: true },
);

async function getStreakData(
  userId: string,
  serverId: string,
): Promise<StreakData | null> {
  const store = await loadClaimedStore();
  const claimedDaily = getServerClaims(store, serverId);

  if (!(userId in claimedDaily)) {
    return null;
  }

  const userClaimData = claimedDaily[userId]!;
  return {
    currentStreak: userClaimData.currentStreak || 0,
    longestStreak: userClaimData.longestStreak || 0,
    bonusStreak: userClaimData.bonusStreak || 0,
  };
}

async function getNextBonusStreak(
  bonusStreak: number,
  serverId: string,
): Promise<NextBonusStreak | null> {
  const [dailyRewards, rewardsOverride] = await Promise.all([
    loadDailyRewardsConfig(),
    loadServerRewardsOverride(serverId),
  ]);
  const pool = rewardPoolForServer(dailyRewards, serverId, rewardsOverride);
  if (!pool.streakBonuses || !Object.keys(pool.streakBonuses).length) {
    return null;
  }

  const bonuses = Object.entries(pool.streakBonuses)
    .map(([key, value]) => ({ streak: parseInt(key, 10), reward: value }))
    .filter((entry) => entry.streak > bonusStreak)
    .sort((a, b) => a.streak - b.streak);

  return bonuses.length > 0 ? bonuses[0]! : null;
}
