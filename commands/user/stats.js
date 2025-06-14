import { SlashCommandBuilder } from "discord.js";
import {
  createPaginatedEmbed,
  createPaginationButtons,
  handlePagination,
} from "../../utils/embed.js";
import {
  findPlayer,
  loadStats,
  flattenStats,
  filterStats,
} from "../../utils/statUtils.js";

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
      .setRequired(false)
  );

export async function execute(interaction) {
  await interaction.deferReply();

  const playerName = interaction.options.getString("player");
  const filterStat = interaction.options.getString("stat");

  try {
    const player = findPlayer(playerName);
    if (!player) {
      return interaction.editReply(
        `❌ Player \`${playerName}\` not found in whitelist.`
      );
    }

    const statsFile = loadStats(player.uuid);
    if (!statsFile) {
      return interaction.editReply(
        `❌ Stats file not found for \`${playerName}\`.`
      );
    }

    let flattened = flattenStats(statsFile.stats);
    flattened = filterStats(flattened, filterStat);

    if (flattened.length === 0) {
      return interaction.editReply(
        `❌ No stats found matching \`${filterStat}\`.`
      );
    }

    // Convert to {name, value} format for embed utility
    const items = flattened.map((stat) => ({
      name: stat.key.replace("minecraft:", ""),
      value: `\`${stat.value.toLocaleString()}\``,
    }));

    const initialEmbed = createPaginatedEmbed(
      `📊 Stats for ${playerName}`,
      items,
      0
    );
    const buttons = createPaginationButtons(0, Math.ceil(items.length / 25));

    // Send initial reply with embed + buttons
    const message = await interaction.editReply({
      embeds: [initialEmbed],
      components: [buttons],
      fetchReply: true,
    });

    if (items.length > 25) {
      // Enable pagination handling only if multiple pages exist
      await handlePagination(message, interaction, `📊 Stats for ${playerName}`, items);
    }
  } catch (err) {
    console.error(err);
    return interaction.editReply("❌ Failed to retrieve stats.");
  }
}
