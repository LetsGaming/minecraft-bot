import { SlashCommandBuilder } from "discord.js";
import { paginateEmbed } from "../utils/embed.js";
import {
  findPlayer,
  loadStats,
  flattenStats,
  filterStats,
} from "../utils/statUtils.js";

const REACTIONS = {
  PREV: "◀️",
  NEXT: "▶️",
};

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
  await interaction.deferReply({ ephemeral: true });

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

    let currentPage = 0;
    const totalPages = Math.ceil(flattened.length / 20);

    const initialEmbed = paginateEmbed(
      `📊 Stats for ${playerName}`,
      flattened,
      currentPage,
      (stat) => ({
        name: stat.key.replace("minecraft:", ""),
        value: `\`${stat.value.toLocaleString()}\``,
        inline: true,
      }),
      { itemsPerPage: 20 }
    );

    await interaction.editReply({
      content: "Loading stats...",
    });

    const message = await interaction.followUp({
      embeds: [initialEmbed],
      fetchReply: true,
    });

    if (totalPages > 1) {
      await message.react(REACTIONS.PREV);
      await message.react(REACTIONS.NEXT);
    }

    const filter = (reaction, user) =>
      [REACTIONS.PREV, REACTIONS.NEXT].includes(reaction.emoji.name) &&
      user.id === interaction.user.id;

    const collector = message.createReactionCollector({
      filter,
      time: 120000,
      dispose: true,
    });

    collector.on("collect", async (reaction) => {
      if (reaction.emoji.name === REACTIONS.PREV) {
        currentPage = currentPage > 0 ? currentPage - 1 : totalPages - 1;
      } else if (reaction.emoji.name === REACTIONS.NEXT) {
        currentPage = currentPage < totalPages - 1 ? currentPage + 1 : 0;
      }

      const newEmbed = paginateEmbed(
        `📊 Stats for ${playerName}`,
        flattened,
        currentPage,
        (stat) => ({
          name: stat.key.replace("minecraft:", ""),
          value: `\`${stat.value.toLocaleString()}\``,
          inline: true,
        }),
        { itemsPerPage: 20 }
      );

      try {
        await message.edit({ embeds: [newEmbed] });
        await reaction.users.remove(interaction.user.id);
      } catch (err) {
        console.error("Failed to update stats embed page:", err);
      }
    });

    collector.on("end", () => {
      message.reactions.removeAll().catch(() => {});
    });
  } catch (err) {
    console.error(err);
    return interaction.editReply("❌ Failed to retrieve stats.");
  }
}
