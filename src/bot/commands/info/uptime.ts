import { formatSpan } from "@mcbot/core/utils/duration.js";
import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../utils/embeds/embedColors.js";
import { describeState } from "../../utils/embeds/serverStateDisplay.js";
import type { ServerState } from "@mcbot/schema/serverState.js";
import {
  getAllInstances,
  getServerInstance,
} from "@mcbot/core/utils/server/server.js";
import {
  resolveServer,
  getAllowedServerIds,
} from "../../utils/guild/guildRouter.js";
import { ALL_SERVERS } from "../../utils/guild/serverOptions.js";
import { getUptimeStats } from "@mcbot/core/utils/stores/uptimeTracker.js";
import { withErrorHandling } from "../middleware.js";

import { t } from "@mcbot/core/utils/i18n.js";
function uptimeBar(pct: number | null, width = 10): string {
  if (pct === null) return `${"░".repeat(width)} ${t("uptime.barNoData")}`;
  const filled = Math.round((pct / 100) * width);
  const bar = "▓".repeat(filled) + "░".repeat(width - filled);
  return `${bar} ${pct.toFixed(1)}%`;
}

/** "🟢 Online for 2 d 7 h", in the same words as /status. */
function describeUptimeState(stats: Awaited<ReturnType<typeof getUptimeStats>>): string {
  const display = describeState(stats.currentState as ServerState);
  const since =
    stats.currentState !== "unknown"
      ? t("uptime.forDuration", { duration: formatSpan(stats.currentStateDuration) })
      : "";
  return `${display.emoji} ${display.label}${since}`;
}

export const data = new SlashCommandBuilder()
  .setName("uptime")
  .setDescription("Show server uptime history")
  .addStringOption((o) =>
    o
      .setName("server")
      .setDescription(
        `Server instance, or "${ALL_SERVERS}" for an overview of every server`,
      )
      .setAutocomplete(true),
  );

export const execute = withErrorHandling(async (interaction) => {
  const requested = interaction.options.getString("server");
  const wantsOverview =
    requested === ALL_SERVERS && !getServerInstance(ALL_SERVERS);

  if (!wantsOverview) {
    const server = resolveServer(interaction);
    const stats = await getUptimeStats(server.id);
    await interaction.editReply({ embeds: [buildSingleEmbed(server.id, stats)] });
    return;
  }

  // In multi-guild deployments the overview only includes servers this
  // guild may target, so no cross-tenant uptime is disclosed.
  const allowed = getAllowedServerIds(interaction.guild?.id);
  const instances = getAllInstances().filter(
    (inst) => !allowed || allowed.has(inst.id),
  );

  // Multi-server overview
  const embed = createEmbed({
    title: t("uptime.overviewTitle"),
    color: EmbedColor.Info,
    timestamp: true,
  });

  for (const server of instances) {
    const stats = await getUptimeStats(server.id);
    const lines = [
      describeUptimeState(stats),
      `24h: ${uptimeBar(stats.pct24h)}`,
      ` 7d: ${uptimeBar(stats.pct7d)}`,
      `30d: ${uptimeBar(stats.pct30d)}`,
    ];

    embed.addFields({
      name: server.id,
      value: lines.join("\n"),
      inline: instances.length <= 3,
    });
  }

  await interaction.editReply({ embeds: [embed] });
});

function buildSingleEmbed(
  serverId: string,
  stats: Awaited<ReturnType<typeof getUptimeStats>>,
) {
  const basis =
    stats.checks24h.total > 0
      ? t("uptime.basedOn", {
          checks24h: stats.checks24h.total,
          checks7d: stats.checks7d.total,
        })
      : t("uptime.noData");
  const embed = createEmbed({
    title: t("uptime.title", { server: serverId }),
    description: `${describeUptimeState(stats)}\n${basis}`,
    color: describeState(stats.currentState as ServerState).color,
    timestamp: true,
  });

  embed.addFields(
    {
      name: t("uptime.last24h"),
      value: uptimeBar(stats.pct24h, 15),
      inline: false,
    },
    { name: t("uptime.last7d"), value: uptimeBar(stats.pct7d, 15), inline: false },
    { name: t("uptime.last30d"), value: uptimeBar(stats.pct30d, 15), inline: false },
  );

  // Hourly sparkline, oldest → newest. Only shown when at least one
  // hour has data; a row of 24 dots would just be noise.
  if (stats.checks24h.total > 0) {
    embed.addFields({
      name: t("uptime.trend"),
      value: t("uptime.trendLegend", { bar: stats.sparkline24h }),
      inline: false,
    });
  }

  return embed;
}
