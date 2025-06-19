import { SlashCommandBuilder } from "discord.js";
import {
  loadStats,
  flattenStats,
  filterStats,
  buildStatsEmbeds,
} from "../../utils/statUtils.js";
import { findPlayer } from "../../utils/utils.js";
import {
  createPaginationButtons,
  handlePagination,
  createErrorEmbed,
} from "../../utils/embed.js";

export const data = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("Show Minecraft stats for a player")
  .addStringOption((option) =>
    option
      .setName("player")
      .setDescription("Minecraft player name")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("stat")
      .setDescription("Optional stat category or specific stat ID")
  );

export async function execute(interaction) {
  await interaction.deferReply();

  const playerName = interaction.options.getString("player");
  const filterStat = interaction.options.getString("stat");

  try {
    const player = await findPlayer(playerName);
    if (!player) {
      const errEmbd = createErrorEmbed(`Player \`${playerName}\` not found.`, {
        footer: { text: "Player Not Found" },
        timestamp: new Date(),
      });
      return interaction.editReply({ embeds: [errEmbd] });
    }

    const statsFile = loadStats(player.uuid);
    if (!statsFile) {
      const errEmbd = createErrorEmbed(
        `Stats file not found for \`${playerName}\`.`,
        {
          footer: { text: "Stats File Not Found" },
          timestamp: new Date(),
        }
      );
      return interaction.editReply({ embeds: [errEmbd] });
    }

    let flattened = flattenStats(statsFile.stats);
    flattened = filterStats(flattened, filterStat);

    if (flattened.length === 0) {
      const errEmbd = createErrorEmbed(
        `No stats found matching \`${filterStat}\`.`,
        {
          footer: { text: "Stats Not Found" },
          timestamp: new Date(),
        }
      );
      return interaction.editReply({ embeds: [errEmbd] });
    }

    const embeds = buildStatsEmbeds(flattened, playerName);

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
  } catch (err) {
    console.error(err);
    return interaction.editReply("❌ Failed to retrieve stats.");
  }
}
