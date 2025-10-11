import { SlashCommandBuilder } from "discord.js";
import {
  loadStats,
  flattenStats,
  findPlayTimeStat,
  formatPlaytime,
} from "../../utils/statUtils.js";
import { findPlayer, playerOption } from "../../utils/utils.js";
import { createEmbed, createErrorEmbed } from "../../utils/embedUtils.js";

export const data = new SlashCommandBuilder()
  .setName("playtime")
  .setDescription("Show total playtime for a player")
  .addStringOption(async (option) => await playerOption(option));

export async function execute(interaction) {
  await interaction.deferReply();

  const playerName = interaction.options.getString("player");

  try {
    const player = await findPlayer(playerName);
    if (!player) {
      const errorEmbed = createErrorEmbed(
        `Player \`${playerName}\` not found.`,
        {
          footer: { text: "Player Not Found" },
          timestamp: new Date(),
        }
      );
      return interaction.editReply({ embeds: [errorEmbed] });
    }

    const statsFile = await loadStats(player.uuid);
    if (!statsFile) {
      const errorEmbed = createErrorEmbed(
        `Stats file not found for \`${playerName}\`.`,
        {
          footer: { text: "Stats File Not Found" },
          timestamp: new Date(),
        }
      );
      return interaction.editReply({ embeds: [errorEmbed] });
    }

    const flattened = flattenStats(statsFile);

    // Find exactly the "play_time" stat in "minecraft:custom" category
    const playTimeStat = findPlayTimeStat(flattened);

    if (!playTimeStat) {
      const errorEmbed = createErrorEmbed(
        `Playtime stat not found for \`${playerName}\`.`,
        {
          footer: { text: "Playtime Stat Not Found" },
          timestamp: new Date(),
        }
      );
      return interaction.editReply({ embeds: [errorEmbed] });
    }

    // Get the total playtime value (seconds), or 0 if not found
    const totalPlaytime = playTimeStat.value ?? 0;

    // Format the total playtime into hours and minutes
    const totalPlaytimeFormatted = formatPlaytime(totalPlaytime);
    if (!totalPlaytimeFormatted) {
      const errorEmbed = createErrorEmbed(
        `Unable to format playtime for \`${playerName}\`.`,
        {
          footer: { text: "Playtime Formatting Error" },
          timestamp: new Date(),
        }
      );
      return interaction.editReply({ embeds: [errorEmbed] });
    }

    // Create the embed with playtime information
    const embed = createEmbed({
      title: `⏳ Playtime for ${playerName}`,
      description: `Total playtime: **${totalPlaytimeFormatted}**`,
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error(err);
    await interaction.editReply({embeds: [createErrorEmbed("An unexpected error occurred.", { footer: { text: "Playtime Error" }, timestamp: new Date() })]});
  }
}
