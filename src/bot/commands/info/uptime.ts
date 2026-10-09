import { formatDuration } from "@mcbot/core/utils/duration.js";
import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../utils/embeds/embedColors.js";
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

function uptimeBar(pct: number | null, width = 10): string {
  if (pct === null) return "░".repeat(width) + " no data";
  const filled = Math.round((pct / 100) * width);
  const bar = "▓".repeat(filled) + "░".repeat(width - filled);
  return `${bar} ${pct.toFixed(1)}%`;
}

function stateEmoji(state: string): string {
  return state === "online" ? "🟢" : state === "offline" ? "🔴" : "⚫";
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
    title: "📈 Server Uptime",
    color: EmbedColor.Info,
  });

  for (const server of instances) {
    const stats = await getUptimeStats(server.id);
    const state = `${stateEmoji(stats.currentState)} ${stats.currentState}`;
    const since =
      stats.currentState !== "unknown"
        ? ` for ${formatDuration(stats.currentStateDuration)}`
        : "";

    const lines = [
      `${state}${since}`,
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
  const state = `${stateEmoji(stats.currentState)} Currently **${stats.currentState}**`;
  const since =
    stats.currentState !== "unknown"
      ? ` for ${formatDuration(stats.currentStateDuration)}`
      : "";

  const embed = createEmbed({
    title: `📈 Uptime — ${serverId}`,
    description: `${state}${since}`,
    color:
      stats.currentState === "online"
        ? EmbedColor.Success
        : stats.currentState === "offline"
          ? EmbedColor.Error
          : EmbedColor.Neutral,
  });

  embed.addFields(
    {
      name: "Last 24 hours",
      value: uptimeBar(stats.pct24h, 15),
      inline: false,
    },
    { name: "Last 7 days", value: uptimeBar(stats.pct7d, 15), inline: false },
    { name: "Last 30 days", value: uptimeBar(stats.pct30d, 15), inline: false },
  );

  // Hourly sparkline, oldest → newest. Only shown when at least one
  // hour has data; a row of 24 dots would just be noise.
  if (stats.checks24h.total > 0) {
    embed.addFields({
      name: "24h trend (hourly)",
      value: `\`${stats.sparkline24h}\` (oldest → now, · = no data)`,
      inline: false,
    });
  }

  if (stats.checks24h.total > 0) {
    embed.setFooter({
      text: `Based on ${stats.checks24h.total} checks (24h) · ${stats.checks7d.total} checks (7d)`,
    });
  } else {
    embed.setFooter({
      text: "No uptime data collected yet — stats populate over time",
    });
  }

  return embed;
}
