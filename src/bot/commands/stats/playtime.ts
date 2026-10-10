import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  loadStats,
  flattenStats,
  findPlayTimeStat,
  formatPlaytime,
} from "@mcbot/core/utils/minecraft/statUtils.js";
import { findPlayer } from "@mcbot/core/utils/minecraft/playerUtils.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import { createEmbed, createErrorEmbed } from "../../utils/embeds/embedUtils.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";

import { t } from "@mcbot/core/utils/i18n.js";
export const data = new SlashCommandBuilder()
  .setName("playtime")
  .setDescription("Show total playtime for a player")
  .addStringOption((option) =>
    option
      .setName("player")
      .setDescription("Minecraft player name")
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply();

  const server = resolveServer(interaction);
  const playerName = interaction.options.getString("player", true);

  try {
    const player = await findPlayer(playerName, server);
    if (!player) {
      await interaction.editReply({
        embeds: [
          createErrorEmbed(t("common.playerNotFound", { player: playerName }), {
            footer: { text: t("common.playerNotFoundFooter") },
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
          createErrorEmbed(t("stats.fileNotFound", { player: playerName }), {
            footer: { text: t("stats.fileNotFoundFooter") },
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
          createErrorEmbed(t("playtime.statNotFound", { player: playerName }), {
            footer: { text: t("playtime.statNotFoundFooter") },
            timestamp: new Date(),
          }),
        ],
      });
      return;
    }

    const totalPlaytimeFormatted = formatPlaytime(totalPlaytime);

    const embed = createEmbed({
      title: t("playtime.title", { player: playerName }),
      description: t("playtime.total", { time: totalPlaytimeFormatted }),
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    log.error("playtime", errMsg(err));
    await interaction.editReply({
      embeds: [
        createErrorEmbed(t("common.unexpectedError"), {
          footer: { text: t("playtime.errorFooter") },
          timestamp: new Date(),
        }),
      ],
    });
  }
}
