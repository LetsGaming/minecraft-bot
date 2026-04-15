import { SlashCommandBuilder } from 'discord.js';
import { LEADERBOARD_STATS, buildLeaderboard } from '../../utils/statUtils.js';
import { withErrorHandling } from '../middleware.js';

const choices = Object.entries(LEADERBOARD_STATS).map(([key, def]) => ({
  name: def.label,
  value: key,
}));

export const data = new SlashCommandBuilder()
  .setName('top')
  .setDescription('Show top players by a stat')
  .addStringOption((o) =>
    o
      .setName('stat')
      .setDescription('Stat to rank by (default: playtime)')
      .addChoices(...choices),
  );

export const execute = withErrorHandling(async (interaction) => {
  const stat = interaction.options.getString('stat') ?? 'playtime';
  const { embed } = await buildLeaderboard(stat);
  await interaction.editReply({ embeds: [embed] });
});
