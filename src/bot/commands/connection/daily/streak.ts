import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  loadDailyRewardsConfig,
  loadServerRewardsOverride,
  loadClaimedStore,
  getServerClaims,
  rewardPoolForServer,
} from "@mcbot/core/utils/stores/dailyStore.js";
import { resolveServer } from "../../../utils/guild/guildRouter.js";
import { createErrorEmbed } from "../../../utils/embeds/embedUtils.js";
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

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userId = interaction.user.id;
  const server = resolveServer(interaction);
  const streakData = await getStreakData(userId, server.id);
  const guildId = interaction.guildId ?? undefined;

  if (!streakData) {
    const errorEmbed = createErrorEmbed(
      t("streak.noData", {}, guildId),
      {
        footer: { text: t("streak.noDataFooter", {}, guildId) },
        timestamp: new Date(),
      },
    );
    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  const { currentStreak, longestStreak, bonusStreak } = streakData;
  const nextBonus = await getNextBonusStreak(bonusStreak, server.id);

  const nextBonusText = nextBonus ? t("streak.days", { count: nextBonus.streak }, guildId)
    : t("streak.na", {}, guildId);

  await interaction.editReply(
    t(
      "streak.info",
      {
        current: t("streak.days", { count: currentStreak }, guildId),
        longest: t("streak.days", { count: longestStreak }, guildId),
        next: nextBonusText,
      },
      guildId,
    ),
  );
}

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
