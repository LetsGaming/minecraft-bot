import { SlashCommandBuilder } from "discord.js";
import {
  loadStats,
  flattenStats,
  filterStats,
  buildStatsEmbeds,
} from "../../utils/statUtils.js";
import {
  createPaginationButtons,
  handlePagination,
  createErrorEmbed,
  createInfoEmbed,
} from "../../utils/embedUtils.js";
import { findPlayer } from "../../utils/utils.js";

export const data = new SlashCommandBuilder()
  .setName("compare")
  .setDescription("Compare stats of two players")
  .addStringOption((option) =>
    option
      .setName("player1")
      .setDescription("First player name")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("player2")
      .setDescription("Second player name")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("stat")
      .setDescription("Optional stat category or specific stat ID")
      .setRequired(false)
  );

export async function execute(interaction) {
  await interaction.deferReply();

  const player1 = interaction.options.getString("player1");
  const player2 = interaction.options.getString("player2");
  const filterStat = interaction.options.getString("stat");

  try {
    const player1Data = await findPlayer(player1);
    const player2Data = await findPlayer(player2);
    // Load stats for both players
    const stats1 = await loadStats(player1Data.uuid);
    const stats2 = await loadStats(player2Data.uuid);

    if (!stats1 || !stats2) {
      const errEmbd = createErrorEmbed(
        `Stats file not found for one or both players: \`${player1}\`, \`${player2}\`.`
      );
      return interaction.editReply({ embeds: [errEmbd] });
    }

    // Flatten and filter stats
    let flattened1 = flattenStats(stats1.stats);
    let flattened2 = flattenStats(stats2.stats);

    if (filterStat) {
      flattened1 = filterStats(flattened1, filterStat);
      flattened2 = filterStats(flattened2, filterStat);
    }

    // Build comparison embeds
    const embeds = buildStatsEmbeds(flattened1, flattened2, player1, player2);

    if (embeds.length === 0) {
      const infoEmbd = createInfoEmbed(
        `No stats found for \`${player1}\` and \`${player2}\`.`
      );
      return interaction.editReply({ embeds: [infoEmbd] });
    }

    if (embeds.length === 1) {
      await interaction.editReply({ embeds });
    } else {
      const message = await interaction.editReply({
        embeds: [embeds[0]],
        components: [createPaginationButtons(0, embeds.length)],
        fetchReply: true,
      });

      await handlePagination(message, interaction, embeds);
    }
  } catch (error) {
    console.error("Error comparing players:", error);
    return interaction.editReply({
      content: "An error occurred while comparing players.",
    });
  }
}
