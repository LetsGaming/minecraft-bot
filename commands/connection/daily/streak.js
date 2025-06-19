import path from "path";
import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { getRootDir, loadJson } from "../../../utils/utils.js";
import { createErrorEmbed } from "../../../utils/embedUtils.js";

const baseDir = getRootDir();
const claimedPath = path.resolve(baseDir, "data", "claimedDaily.json");
const dailyRewardsPath = path.resolve(baseDir, "data", "dailyRewards.json");

export const data = new SlashCommandBuilder()
  .setName("streak")
  .setDescription("Get information about your daily streak");

export async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Placeholder for actual streak logic
  const userId = interaction.user.id;
  const streakData = await getStreakData(userId);

  if (!streakData) {
    const errorEmbed = createErrorEmbed(
      "No streak data found for your account.",
      {
        footer: { text: "Streak Data Not Found" },
        timestamp: new Date(),
      }
    );
    return interaction.editReply({ embeds: [errorEmbed] });
  }

  const { currentStreak, longestStreak, bonusStreak } = streakData;
  const nextBonus = await getNextBonusStreak(bonusStreak);

  await interaction.editReply(
    `📅 **Daily Streak Information**\n` +
      `**Current Streak:** ${currentStreak} days\n` +
      `**Longest Streak:** ${longestStreak} days\n` +
      `**Next Bonus Streak:** ${nextBonus.streak} days `
  );
}

async function getStreakData(userId) {
  // Placeholder function to fetch streak data
  // This should read from the claimedPath or any other source where streak data is stored
  const claimedDaily = await loadJson(claimedPath).catch(() => ({}));

  if (!(userId in claimedDaily)) {
    return null; // No streak data found for this user
  }

  const userClaimData = claimedDaily[userId];
  return {
    currentStreak: userClaimData.currentStreak || 0,
    longestStreak: userClaimData.longestStreak || 0,
    bonusStreak: userClaimData.bonusStreak || 0,
  };
}

async function getNextBonusStreak(bonusStreak) {
  const dailyRewards = await loadJson(dailyRewardsPath).catch(() => ({}));
  if (!dailyRewards || !Object.keys(dailyRewards).length) {
    return null; // No daily rewards configured
  }

  const bonuses = Object.entries(dailyRewards.streakBonuses)
    .map(([key, value]) => ({ streak: parseInt(key), reward: value }))
    .filter((entry) => entry.streak > bonusStreak)
    .sort((a, b) => a.streak - b.streak);

  return bonuses.length > 0 ? bonuses[0] : null;
}
