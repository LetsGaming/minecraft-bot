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

const categoryLabels = {
  used: "Used",
  mined: "Mined",
  picked_up: "Picked Up",
  dropped: "Dropped",
  broken: "Broken",
  crafted: "Crafted",
  custom: "Custom",
  killed: "Killed",
  killed_by: "Killed By",
};

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

    // Group stats by category
    const groupedItems = flattened.reduce((groups, stat) => {
      // Remove "minecraft:" prefix from category
      const rawCategory = stat.category.replace("minecraft:", "");
      if (!groups[rawCategory]) groups[rawCategory] = [];

      // Format stat name: remove prefix, replace underscores with spaces
      const prettyStatName = stat.key
        .replace("minecraft:", "")
        .replace(/_/g, " ");

      groups[rawCategory].push({
        name: prettyStatName,
        value: `\`${stat.value.toLocaleString()}\``,
      });

      return groups;
    }, {});

    // Flatten grouped items into an array with category headers
    const paginatedItems = [];

    for (const [category, stats] of Object.entries(groupedItems)) {
      const prettyCategory = categoryLabels[category] || category;
      paginatedItems.push({
        name: `== ${prettyCategory} ==`,
        value: "\u200b", // zero-width space for embed formatting
      });
      paginatedItems.push(...stats);
    }

    const initialEmbed = createPaginatedEmbed(
      `📊 Stats for ${playerName}`,
      paginatedItems,
      0
    );
    const buttons = createPaginationButtons(
      0,
      Math.ceil(paginatedItems.length / 25)
    );

    const message = await interaction.editReply({
      embeds: [initialEmbed],
      components: [buttons],
      fetchReply: true,
    });

    if (paginatedItems.length > 25) {
      await handlePagination(
        message,
        interaction,
        `📊 Stats for ${playerName}`,
        paginatedItems
      );
    }
  } catch (err) {
    console.error(err);
    return interaction.editReply("❌ Failed to retrieve stats.");
  }
}
