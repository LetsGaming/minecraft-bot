import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  loadStats,
  flattenStats,
  findPlayTimeStat,
  formatPlaytime,
} from "../../utils/statUtils.js";
import { findPlayer } from "../../utils/playerUtils.js";
import { resolveServer } from "../../utils/guildRouter.js";
import { createEmbed, createErrorEmbed } from "../../utils/embedUtils.js";
import { log } from "../../utils/logger.js";

export const data = new SlashCommandBuilder()
  .setName("playtime")
  .setDescription("Show total playtime for a player")
  .addStringOption((option) =>
    option
      .setName("player")
      .setDescription("Minecraft player name")
      .setRequired(true)
      .setAutocomplete(true),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply();

  const server = resolveServer(interaction) ?? undefined;
  const playerName = interaction.options.getString("player", true);

  try {
    const player = await findPlayer(playerName, server);
    if (!player) {
      await interaction.editReply({
        embeds: [
          createErrorEmbed(`Player \`${playerName}\` not found.`, {
            footer: { text: "Player Not Found" },
            timestamp: new Date(),
          }),
        ],
      });
      return;
    }

    const statsFile = await loadStats(player.uuid, server);
    if (!statsFile) {
      await interaction.editReply({
        embeds: [
          createErrorEmbed(`Stats file not found for \`${playerName}\`.`, {
            footer: { text: "Stats File Not Found" },
            timestamp: new Date(),
          }),
        ],
      });
      return;
    }

    const flattened = flattenStats(statsFile);
    const totalPlaytime = findPlayTimeStat(flattened);

    if (!totalPlaytime) {
      await interaction.editReply({
        embeds: [
          createErrorEmbed(`Playtime stat not found for \`${playerName}\`.`, {
            footer: { text: "Playtime Stat Not Found" },
            timestamp: new Date(),
          }),
        ],
      });
      return;
    }

    const totalPlaytimeFormatted = formatPlaytime(totalPlaytime);

    const embed = createEmbed({
      title: `⏳ Playtime for ${playerName}`,
      description: `Total playtime: **${totalPlaytimeFormatted}**`,
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    log.error("playtime", err instanceof Error ? err.message : String(err));
    await interaction.editReply({
      embeds: [
        createErrorEmbed("An unexpected error occurred.", {
          footer: { text: "Playtime Error" },
          timestamp: new Date(),
        }),
      ],
    });
  }
}
