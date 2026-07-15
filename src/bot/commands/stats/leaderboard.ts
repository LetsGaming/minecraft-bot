import { SlashCommandBuilder } from "discord.js";
import { LEADERBOARD_STATS, buildLeaderboard } from "@mcbot/core/utils/minecraft/statUtils.js";
import {
  isStreakStatKey,
  buildStreakLeaderboard,
  STREAK_STAT_LABELS,
} from "@mcbot/core/utils/minecraft/streakLeaderboard.js";
import { buildLeaderboardEmbed } from "../../utils/embeds/statEmbeds.js";
import { withErrorHandling } from "../middleware.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";

const choices = [
  ...Object.entries(LEADERBOARD_STATS).map(([key, def]) => ({
    name: def.label,
    value: key,
  })),
  ...Object.entries(STREAK_STAT_LABELS).map(([key, label]) => ({
    name: label,
    value: key,
  })),
];

export const data = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("Show top players by a stat")
  .addStringOption((o) =>
    o
      .setName("stat")
      .setDescription("Stat to rank by (default: playtime)")
      .addChoices(...choices),
  );

export const execute = withErrorHandling(async (interaction) => {
  const stat = interaction.options.getString("stat") ?? "playtime";
  const server = resolveServer(interaction);
  const leaderboardData = isStreakStatKey(stat)
    ? await buildStreakLeaderboard(stat, server.id)
    : await buildLeaderboard(stat, { server });
  const embed = buildLeaderboardEmbed(leaderboardData);
  await interaction.editReply({ embeds: [embed] });
});
