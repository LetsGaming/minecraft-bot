import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embeds/embedUtils.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";

import { withErrorHandling } from "../middleware.js";
import {
  getHostResources,
  formatBytes,
} from "@mcbot/core/utils/server/hostResources.js";
import { t } from "@mcbot/core/utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Get the current status of a Minecraft server")
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

export const execute = withErrorHandling(async (interaction) => {
  const sent = Date.now();
  const server = resolveServer(interaction);
  if (!server) throw new Error("Server not found.");

  const running = await server.isRunning();
  const botPing = interaction.client.ws.ping;
  const roundTrip = Date.now() - sent;

  if (!running) {
    const embed = createEmbed({
      title: `Server Status — ${server.id}`,
      description: "**Offline**",
    });
    embed.addFields(
      { name: "Bot Ping", value: `${botPing}ms`, inline: true },
      { name: "Round Trip", value: `${roundTrip}ms`, inline: true },
    );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const { playerCount, maxPlayers, players } = await server.getList();
  const embed = createEmbed({
    title: `Server Status — ${server.id}`,
    description: `**Online** — ${playerCount}/${maxPlayers} players`,
  });
  if (players.length > 0)
    embed.addFields({
      name: "Online",
      value: players.join(", "),
      inline: false,
    });
  embed.addFields(
    { name: "Bot Ping", value: `${botPing}ms`, inline: true },
    { name: "Round Trip", value: `${roundTrip}ms`, inline: true },
  );

  // Host section: process RAM/CPU + disk usage for local instances.
  // Remote instances get these via the wrapper /info extension later;
  // any failure here must never break the status reply.
  try {
    const host = await getHostResources(server);
    if (host) {
      const lines: string[] = [];
      if (host.process) {
        lines.push(
          t("status.hostProcess", {
            ram: formatBytes(host.process.rssBytes),
            cpu: host.process.cpuPercent.toFixed(0),
          }),
        );
      }
      for (const disk of host.disks) {
        lines.push(
          t("status.hostDisk", {
            path: disk.path,
            percent: disk.usedPercent,
            free: formatBytes(disk.availableBytes),
          }),
        );
      }
      if (lines.length > 0) {
        embed.addFields({
          name: t("status.hostTitle"),
          value: lines.join("\n"),
          inline: false,
        });
      }
    }
  } catch {
    /* host metrics are additive — never fail the status */
  }

  await interaction.editReply({ embeds: [embed] });
});
