import path from 'path';
import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import { getRootDir, loadJson } from '../../../utils/utils.js';
import { createErrorEmbed } from '../../../utils/embedUtils.js';
import type { DailyRewardsConfig, StreakData, NextBonusStreak, UserClaimData } from '../../../types/index.js';

const baseDir = getRootDir();
const claimedPath = path.resolve(baseDir, 'data', 'claimedDaily.json');
const dailyRewardsPath = path.resolve(baseDir, 'data', 'dailyRewards.json');

export const data = new SlashCommandBuilder()
  .setName('streak')
  .setDescription('Get information about your daily streak');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userId = interaction.user.id;
  const streakData = await getStreakData(userId);

  if (!streakData) {
    const errorEmbed = createErrorEmbed(
      'No streak data found for your account.',
      {
        footer: { text: 'Streak Data Not Found' },
        timestamp: new Date(),
      },
    );
    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  const { currentStreak, longestStreak, bonusStreak } = streakData;
  const nextBonus = await getNextBonusStreak(bonusStreak);

  const nextBonusText = nextBonus ? `${nextBonus.streak} days` : 'N/A';

  await interaction.editReply(
    `📅 **Daily Streak Information**\n` +
      `**Current Streak:** ${currentStreak} days\n` +
      `**Longest Streak:** ${longestStreak} days\n` +
      `**Next Bonus Streak:** ${nextBonusText} `,
  );
}

async function getStreakData(userId: string): Promise<StreakData | null> {
  const claimedDaily = (await loadJson(claimedPath).catch(() => ({}))) as Record<string, UserClaimData>;

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

async function getNextBonusStreak(bonusStreak: number): Promise<NextBonusStreak | null> {
  const dailyRewards = (await loadJson(dailyRewardsPath).catch(() => ({}))) as DailyRewardsConfig;
  if (!dailyRewards?.streakBonuses || !Object.keys(dailyRewards.streakBonuses).length) {
    return null;
  }

  const bonuses = Object.entries(dailyRewards.streakBonuses)
    .map(([key, value]) => ({ streak: parseInt(key, 10), reward: value }))
    .filter((entry) => entry.streak > bonusStreak)
    .sort((a, b) => a.streak - b.streak);

  return bonuses.length > 0 ? bonuses[0]! : null;
}
