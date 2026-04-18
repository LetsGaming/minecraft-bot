import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import {
  loadStats,
  flattenStats,
  filterStats,
} from '../../utils/statUtils.js';
import { buildStatsEmbeds } from '../../utils/statEmbeds.js';
import { findPlayer } from '../../utils/playerUtils.js';
import { resolveServer } from '../../utils/guildRouter.js';
import { log } from '../../utils/logger.js';
import {
  createPaginationButtons,
  handlePagination,
  createErrorEmbed,
} from '../../utils/embedUtils.js';

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Show Minecraft stats for a player')
  .addStringOption((option) =>
    option
      .setName('player')
      .setDescription('Minecraft player name')
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption((option) =>
    option
      .setName('stat')
      .setDescription('Optional stat category or specific stat ID'),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const server = resolveServer(interaction) ?? undefined;
  const playerName = interaction.options.getString('player', true);
  const filterStat = interaction.options.getString('stat');

  try {
    const player = await findPlayer(playerName, server);
    if (!player) {
      await interaction.editReply({
        embeds: [createErrorEmbed(`Player \`${playerName}\` not found.`, {
          footer: { text: 'Player Not Found' },
          timestamp: new Date(),
        })],
      });
      return;
    }

    const statsFile = await loadStats(player.uuid, server);
    if (!statsFile) {
      await interaction.editReply({
        embeds: [createErrorEmbed(`Stats file not found for \`${playerName}\`.`, {
          footer: { text: 'Stats File Not Found' },
          timestamp: new Date(),
        })],
      });
      return;
    }

    let flattened = flattenStats(statsFile);
    flattened = filterStats(flattened, filterStat);

    if (flattened.length === 0) {
      await interaction.editReply({
        embeds: [createErrorEmbed(`No stats found matching \`${filterStat}\`.`, {
          footer: { text: 'Stats Not Found' },
          timestamp: new Date(),
        })],
      });
      return;
    }

    const embeds = buildStatsEmbeds(flattened, playerName);

    if (embeds.length === 1) {
      await interaction.editReply({ embeds });
    } else {
      const message = await interaction.editReply({
        embeds: [embeds[0]!],
        components: [createPaginationButtons(0, embeds.length)],
      });

      await handlePagination(message, interaction, embeds);
    }
  } catch (err) {
    log.error('stats', err instanceof Error ? err.message : String(err));
    await interaction.editReply({
      embeds: [createErrorEmbed('Failed to retrieve stats.')],
    });
  }
}
