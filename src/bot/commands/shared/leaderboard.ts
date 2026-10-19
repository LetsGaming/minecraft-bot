import { SlashCommandBuilder, type SlashCommandOptionsOnlyBuilder } from "discord.js";
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

/** The slash command definition shared by `/top` and `/leaderboard`. */
export function buildLeaderboardData(name: string): SlashCommandOptionsOnlyBuilder {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription("Show top players by a stat")
    .addStringOption((o) =>
      o
        .setName("stat")
        .setDescription("Stat to rank by (default: playtime)")
        .addChoices(...choices),
    )
    .addStringOption((o) =>
      o.setName("server").setDescription("Server instance").setAutocomplete(true),
    );
}

export const executeLeaderboard = withErrorHandling(async (interaction) => {
  const stat = interaction.options.getString("stat") ?? "playtime";
  const server = resolveServer(interaction);
  const leaderboardData = isStreakStatKey(stat)
    ? await buildStreakLeaderboard(stat, server.id)
    : await buildLeaderboard(stat, { server });
  await interaction.editReply({ embeds: [buildLeaderboardEmbed(leaderboardData)] });
});
