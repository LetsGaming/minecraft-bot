import { SlashCommandBuilder } from "discord.js";
import { createEmbed, createErrorEmbed } from "../../utils/embedUtils.js";
import { getServerInstance } from "../../utils/server.js";
import { getGuildServer } from "../../config.js";
import { withErrorHandling } from "../middleware.js";

export const data = new SlashCommandBuilder()
  .setName("tps")
  .setDescription("Check server TPS (ticks per second)")
  .addStringOption(o => o.setName("server").setDescription("Server instance").setAutocomplete(true));

export const execute = withErrorHandling(async (interaction) => {
  const serverId = interaction.options.getString("server");
  const server = serverId ? getServerInstance(serverId) : getGuildServer(interaction.guild?.id);
  if (!server) throw new Error("Server not found.");

  if (!server.useRcon) throw new Error("TPS monitoring requires RCON.");

  const tps = await server.getTps();
  if (!tps) throw new Error("Could not retrieve TPS. Server may be offline.");

  const tpsColor = tps.tps1m >= 18 ? 0x55ff55 : tps.tps1m >= 15 ? 0xffaa00 : 0xff5555;
  const emoji = tps.tps1m >= 18 ? "🟢" : tps.tps1m >= 15 ? "🟡" : "🔴";

  const embed = createEmbed({
    title: `${emoji} TPS — ${server.id}`,
    color: tpsColor,
  });

  if (tps.tps5m !== undefined) {
    embed.addFields(
      { name: "1 min", value: `${tps.tps1m.toFixed(1)}`, inline: true },
      { name: "5 min", value: `${tps.tps5m.toFixed(1)}`, inline: true },
      { name: "15 min", value: `${tps.tps15m.toFixed(1)}`, inline: true },
    );
  } else {
    embed.setDescription(`Current TPS: **${tps.tps1m.toFixed(1)}**`);
  }

  if (tps.raw) embed.setFooter({ text: tps.raw.slice(0, 100) });

  await interaction.editReply({ embeds: [embed] });
});
