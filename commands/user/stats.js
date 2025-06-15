import { SlashCommandBuilder } from "discord.js";
import {
  findPlayer,
  loadStats,
  flattenStats,
  filterStats,
  buildStatsEmbed,
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

    const embed = buildStatsEmbed(flattened, playerName);
    await interaction.reply({ embeds: [embed] });
  } catch (err) {
    console.error(err);
    return interaction.editReply("❌ Failed to retrieve stats.");
  }
}
