import { SlashCommandBuilder } from "discord.js";
import {
  flattenStats,
  findPlayTimeStat,
  ticksToMs,
} from "@mcbot/core/utils/minecraft/statUtils.js";
import { findPlayer } from "@mcbot/core/utils/minecraft/playerUtils.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import { createPlayerEmbed } from "../../utils/embeds/embedUtils.js";
import { withErrorHandling } from "../middleware.js";
import { CommandError } from "@mcbot/core/utils/error.js";
import { loadStatsOrFail, noStatsYet, playerNotFound } from "./statErrors.js";

import { formatSpan } from "@mcbot/core/utils/duration.js";
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

export const execute = withErrorHandling(async (interaction) => {
  const server = resolveServer(interaction);
  const playerName = interaction.options.getString("player", true);

  const player = await findPlayer(playerName, server);
  if (!player) throw playerNotFound(playerName);

  const statsFile = await loadStatsOrFail(player.uuid, server);
  if (!statsFile) throw noStatsYet(playerName);

  const totalPlaytime = findPlayTimeStat(flattenStats(statsFile));
  if (!totalPlaytime) {
    throw new CommandError({
      title: t("playtime.statNotFoundTitle"),
      problem: t("playtime.statNotFound", { player: playerName }),
      recovery: t("stats.fileNotFoundRecovery"),
    });
  }

  await interaction.editReply({
    embeds: [
      createPlayerEmbed(playerName, {
        title: t("playtime.title", { player: playerName }),
        description: t("playtime.total", { time: formatSpan(ticksToMs(totalPlaytime)) }),
        asThumbnail: true,
      }),
    ],
  });
});
