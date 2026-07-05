import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  loadDailyRewardsConfig,
  loadClaimedStore,
  getServerClaims,
  rewardPoolForServer,
} from "../../../../common/utils/dailyStore.js";
import { resolveServer } from "../../../utils/guildRouter.js";
import { createErrorEmbed } from "../../../utils/embedUtils.js";
import type { StreakData, NextBonusStreak } from "../../../../common/types/index.js";

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

  if (!streakData) {
    const errorEmbed = createErrorEmbed(
      "No streak data found for your account.",
      {
        footer: { text: "Streak Data Not Found" },
        timestamp: new Date(),
      },
    );
    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  const { currentStreak, longestStreak, bonusStreak } = streakData;
  const nextBonus = await getNextBonusStreak(bonusStreak, server.id);

  const nextBonusText = nextBonus ? `${nextBonus.streak} days` : "N/A";

  await interaction.editReply(
    `📅 **Daily Streak Information**\n` +
      `**Current Streak:** ${currentStreak} days\n` +
      `**Longest Streak:** ${longestStreak} days\n` +
      `**Next Bonus Streak:** ${nextBonusText} `,
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
  const dailyRewards = await loadDailyRewardsConfig();
  const pool = rewardPoolForServer(dailyRewards, serverId);
  if (!pool.streakBonuses || !Object.keys(pool.streakBonuses).length) {
    return null;
  }

  const bonuses = Object.entries(pool.streakBonuses)
    .map(([key, value]) => ({ streak: parseInt(key, 10), reward: value }))
    .filter((entry) => entry.streak > bonusStreak)
    .sort((a, b) => a.streak - b.streak);

  return bonuses.length > 0 ? bonuses[0]! : null;
}
