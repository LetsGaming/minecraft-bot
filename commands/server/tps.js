import { SlashCommandBuilder } from "discord.js";
import { createEmbed, createErrorEmbed } from "../../utils/embedUtils.js";
import { getServerInstance } from "../../utils/server.js";
import { getGuildServer } from "../../config.js";
import { withErrorHandling } from "../middleware.js";

export const data = new SlashCommandBuilder()
  .setName("tps")
  .setDescription("Check server TPS (ticks per second)")
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

export const execute = withErrorHandling(async (interaction) => {
  const serverId = interaction.options.getString("server");
  const server = serverId
    ? getServerInstance(serverId)
    : getGuildServer(interaction.guild?.id);

  if (!server) throw new Error("Server not found.");
  if (!server.useRcon) throw new Error("TPS monitoring requires RCON.");

  const tps = await server.getTps();

  // 1. Check if the response exists and contains a valid number
  if (!tps || typeof tps.tps1m !== "number" || isNaN(tps.tps1m)) {
    throw new Error(
      `Could not parse TPS data. Raw response: ${tps?.raw || "No response"}`,
    );
  }

  const { tps1m, tps5m, tps15m, raw } = tps;

  // 2. Logic for color and emoji based on valid numbers
  const tpsColor = tps1m >= 18 ? 0x55ff55 : tps1m >= 15 ? 0xffaa00 : 0xff5555;
  const emoji = tps1m >= 18 ? "🟢" : tps1m >= 15 ? "🟡" : "🔴";

  const embed = createEmbed({
    title: `${emoji} TPS — ${server.id}`,
    color: tpsColor,
  });

  // 3. Display fields if all timeframes are valid numbers
  if (Number.isFinite(tps5m) && Number.isFinite(tps15m)) {
    embed.addFields(
      { name: "1 min", value: tps1m.toFixed(1), inline: true },
      { name: "5 min", value: tps5m.toFixed(1), inline: true },
      { name: "15 min", value: tps15m.toFixed(1), inline: true },
    );
  } else {
    embed.setDescription(`Current TPS: **${tps1m.toFixed(1)}**`);
  }

  if (raw) embed.setFooter({ text: raw.slice(0, 100) });

  await interaction.editReply({ embeds: [embed] });
});
