import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../utils/embeds/embedColors.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import { classifyTps, type HealthLevel } from "@mcbot/schema";

import { withErrorHandling } from "../middleware.js";

import { t } from "@mcbot/core/utils/i18n.js";
const LEVEL_COLOR: Record<HealthLevel, number> = {
  ok: EmbedColor.Success,
  warn: EmbedColor.Warning,
  critical: EmbedColor.Error,
};

export const data = new SlashCommandBuilder()
  .setName("tps")
  .setDescription("Check server TPS (ticks per second)")
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

export const execute = withErrorHandling(async (interaction) => {
  const server = resolveServer(interaction);
  const tps = await server.getTps();
  if (!tps) throw new Error(t("tps.unavailable"));

  const tpsColor = LEVEL_COLOR[classifyTps(tps.tps1m)];

  const embed = createEmbed({
    title: t("tps.title", { server: server.id }),
    color: tpsColor,
    timestamp: true,
  });

  if ("tps5m" in tps && tps.tps5m !== undefined) {
    // Paper/Spigot/Purpur: 1m, 5m, 15m averages
    const paperTps = tps;
    embed.addFields(
      { name: t("tps.avg1m"), value: `${paperTps.tps1m.toFixed(1)}`, inline: true },
      { name: t("tps.avg5m"), value: `${paperTps.tps5m.toFixed(1)}`, inline: true },
      { name: t("tps.avg15m"), value: `${paperTps.tps15m.toFixed(1)}`, inline: true },
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
        name: t("tps.tickTiming"),
        value: `P50: ${tps.p50.toFixed(1)}ms · P95: ${tps.p95.toFixed(1)}ms · P99: ${tps.p99.toFixed(1)}ms`,
        inline: false,
      });
    }
  } else {
    embed.setDescription(t("tps.current", { value: tps.tps1m.toFixed(1) }));
  }

  await interaction.editReply({ embeds: [embed] });
});
