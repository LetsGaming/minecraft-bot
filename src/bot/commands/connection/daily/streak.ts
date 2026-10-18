import { SlashCommandBuilder } from "discord.js";
import {
  loadDailyRewardsConfig,
  loadServerRewardsOverride,
  loadClaimedStore,
  getServerClaims,
  rewardPoolForServer,
} from "@mcbot/core/utils/stores/dailyStore.js";
import { resolveServer } from "../../../utils/guild/guildRouter.js";
import { createPlayerEmbed } from "../../../utils/embeds/embedUtils.js";
import { milestoneTrack, progressBar } from "../../../utils/embeds/gameDisplay.js";
import { getLinkedAccount } from "@mcbot/core/utils/stores/linkUtils.js";
import { liveStreak, liveBonusStreak, milestoneDays, nextMilestone } from "@mcbot/core/utils/minecraft/rewards.js";
import { EmbedCategory } from "@mcbot/schema/embedCategories.js";
import { withErrorHandling } from "../../middleware.js";
import { CommandError } from "@mcbot/core/utils/error.js";
import type { StreakData, RewardPool } from "@mcbot/core/types/index.js";

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
    const pool = await getPool(server.id);
    const nextBonus = nextMilestone(bonusStreak, pool.streakBonuses);
    const days = milestoneDays(pool.streakBonuses);

    const embed = createPlayerEmbed(await getLinkedAccount(interaction.user.id) ?? interaction.user.username, {
      title: t("streak.title", { server: server.id }),
      category: EmbedCategory.Reward,
    }).addFields(
      { name: `🔥 ${t("streak.current")}`, value: t("streak.days", { count: currentStreak }), inline: true },
      { name: `🏅 ${t("streak.longest")}`, value: t("streak.days", { count: longestStreak }), inline: true },
      {
        name: `🎯 ${t("streak.nextBonus")}`,
        value: nextBonus ? t("streak.days", { count: nextBonus.day }) : t("streak.na"),
        inline: true,
      },
    );
    if (nextBonus) {
      embed.addFields({
        name: t("streak.barField"),
        value: `${progressBar(bonusStreak, nextBonus.day, 10)} ${bonusStreak}/${nextBonus.day}`,
      });
    }
    if (days.length > 0) {
      embed.addFields({ name: t("streak.trackField"), value: milestoneTrack(bonusStreak, days) });
    }

    await interaction.editReply({ embeds: [embed] });
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
    currentStreak: liveStreak(userClaimData),
    longestStreak: userClaimData.longestStreak || 0,
    bonusStreak: liveBonusStreak(userClaimData),
  };
}

async function getPool(serverId: string): Promise<RewardPool> {
  const [dailyRewards, rewardsOverride] = await Promise.all([
    loadDailyRewardsConfig(),
    loadServerRewardsOverride(serverId),
  ]);
  return rewardPoolForServer(dailyRewards, rewardsOverride);
}
