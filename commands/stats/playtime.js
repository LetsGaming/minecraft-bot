import { SlashCommandBuilder } from "discord.js";
import {loadStats, flattenStats } from "../../utils/statUtils.js";
import { findPlayer } from "../../utils/utils.js";
import { createEmbed } from "../../utils/embed.js";

export const data = new SlashCommandBuilder()
  .setName("playtime")
  .setDescription("Show total playtime for a player")
  .addStringOption((option) =>
    option
      .setName("player")
      .setDescription("Minecraft player name")
      .setRequired(true)
  );

export async function execute(interaction) {
  await interaction.deferReply();

  const playerName = interaction.options.getString("player");

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

    const flattened = flattenStats(statsFile.stats);

    // Find exactly the "play_time" stat in "minecraft:custom" category
    const playTimeStat = flattened.find(
      (stat) => stat.key === "play_time" && stat.category === "minecraft:custom"
    );

    if (!playTimeStat) {
      return interaction.editReply(
        `❌ Playtime stat not found for \`${playerName}\`.`
      );
    }

    // Get the total playtime value (seconds), or 0 if not found
    const totalPlaytime = playTimeStat?.value ?? 0;

    // Convert total playtime (seconds) to HH:MM:SS format
    const hours = Math.floor(totalPlaytime / 3600);
    const minutes = Math.floor((totalPlaytime % 3600) / 60);
    const seconds = totalPlaytime % 60;
    const totalPlaytimeFormatted = `${hours}h ${minutes}m ${seconds}s`;

    // Create the embed with playtime information
    const embed = createEmbed({
      title: `⏳ Playtime for ${playerName}`,
      description: `Total playtime: **${totalPlaytimeFormatted}**`,
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error(err);
    await interaction.editReply(`❌ An unexpected error occurred.`);
  }
}
