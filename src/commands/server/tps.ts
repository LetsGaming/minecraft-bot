import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embedUtils.js";
import { resolveServer } from "../../utils/guildRouter.js";

import { withErrorHandling } from "../middleware.js";

export const data = new SlashCommandBuilder()
  .setName("tps")
  .setDescription("Check server TPS (ticks per second)")
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

export const execute = withErrorHandling(async (interaction) => {
  const server = resolveServer(interaction);
  if (!server) throw new Error("Server not found.");

  if (!server.supportsTps)
    throw new Error("TPS monitoring requires RCON or an API wrapper.");

  const tps = await server.getTps();
  if (!tps) throw new Error("Could not retrieve TPS. Server may be offline.");

  const tpsColor =
    tps.tps1m >= 18 ? 0x55ff55 : tps.tps1m >= 15 ? 0xffaa00 : 0xff5555;
  const emoji = tps.tps1m >= 18 ? "🟢" : tps.tps1m >= 15 ? "🟡" : "🔴";

  const embed = createEmbed({
    title: `${emoji} TPS — ${server.id}`,
    color: tpsColor,
  });

  if ("tps5m" in tps && tps.tps5m !== undefined) {
    // Paper/Spigot/Purpur: 1m, 5m, 15m averages
    const paperTps = tps as import("../../types/index.js").PaperTpsResult;
    embed.addFields(
      { name: "1 min", value: `${paperTps.tps1m.toFixed(1)}`, inline: true },
      { name: "5 min", value: `${paperTps.tps5m.toFixed(1)}`, inline: true },
      { name: "15 min", value: `${paperTps.tps15m.toFixed(1)}`, inline: true },
    );
  } else if ("mspt" in tps && tps.mspt !== undefined) {
    // Vanilla: TPS derived from MSPT + percentiles
    embed.addFields(
      { name: "TPS", value: `${tps.tps1m.toFixed(1)}`, inline: true },
      { name: "MSPT", value: `${tps.mspt.toFixed(1)}ms`, inline: true },
    );
    if (
      "p50" in tps &&
      tps.p50 !== undefined &&
      "p95" in tps &&
      tps.p95 !== undefined &&
      "p99" in tps &&
      tps.p99 !== undefined
    ) {
      embed.addFields({
        name: "Tick Timing",
        value: `P50: ${tps.p50.toFixed(1)}ms · P95: ${tps.p95.toFixed(1)}ms · P99: ${tps.p99.toFixed(1)}ms`,
        inline: false,
      });
    }
  } else {
    embed.setDescription(`Current TPS: **${tps.tps1m.toFixed(1)}**`);
  }

  if (tps.raw) embed.setFooter({ text: tps.raw.slice(0, 100) });

  await interaction.editReply({ embeds: [embed] });
});
