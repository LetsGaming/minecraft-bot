import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embedUtils.js';
import { getAllInstances } from '../../utils/server.js';
import { resolveServer } from '../../utils/guildRouter.js';
import { getUptimeStats } from '../../utils/uptimeTracker.js';
import { withErrorHandling } from '../middleware.js';

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);

  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || parts.length === 0) parts.push(`${m}m`);
  return parts.join(' ');
}

function uptimeBar(pct: number | null, width = 10): string {
  if (pct === null) return '░'.repeat(width) + ' no data';
  const filled = Math.round((pct / 100) * width);
  const bar = '▓'.repeat(filled) + '░'.repeat(width - filled);
  return `${bar} ${pct.toFixed(1)}%`;
}

function stateEmoji(state: string): string {
  return state === 'online' ? '🟢' : state === 'offline' ? '🔴' : '⚫';
}

export const data = new SlashCommandBuilder()
  .setName('uptime')
  .setDescription('Show server uptime history')
  .addStringOption((o) =>
    o.setName('server').setDescription('Server instance').setAutocomplete(true),
  );

export const execute = withErrorHandling(async (interaction) => {
  const serverId = interaction.options.getString('server');

  // If a specific server is requested, show just that one
  if (serverId) {
    const server = resolveServer(interaction);

    const stats = await getUptimeStats(server.id);
    const embed = buildSingleEmbed(server.id, stats);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Otherwise show all servers, or the guild default if only one
  const instances = getAllInstances();

  if (instances.length === 1) {
    const server = instances[0]!;
    const stats = await getUptimeStats(server.id);
    const embed = buildSingleEmbed(server.id, stats);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Multi-server overview
  const embed = createEmbed({
    title: '📈 Server Uptime',
    color: 0x00bfff,
  });

  for (const server of instances) {
    const stats = await getUptimeStats(server.id);
    const state = `${stateEmoji(stats.currentState)} ${stats.currentState}`;
    const since =
      stats.currentState !== 'unknown'
        ? ` for ${formatDuration(stats.currentStateDuration)}`
        : '';

    const lines = [
      `${state}${since}`,
      `24h: ${uptimeBar(stats.pct24h)}`,
      ` 7d: ${uptimeBar(stats.pct7d)}`,
      `30d: ${uptimeBar(stats.pct30d)}`,
    ];

    embed.addFields({
      name: server.id,
      value: lines.join('\n'),
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
    stats.currentState !== 'unknown'
      ? ` for ${formatDuration(stats.currentStateDuration)}`
      : '';

  const embed = createEmbed({
    title: `📈 Uptime — ${serverId}`,
    description: `${state}${since}`,
    color:
      stats.currentState === 'online'
        ? 0x55ff55
        : stats.currentState === 'offline'
          ? 0xff5555
          : 0x888888,
  });

  embed.addFields(
    { name: 'Last 24 hours', value: uptimeBar(stats.pct24h, 15), inline: false },
    { name: 'Last 7 days', value: uptimeBar(stats.pct7d, 15), inline: false },
    { name: 'Last 30 days', value: uptimeBar(stats.pct30d, 15), inline: false },
  );

  if (stats.checks24h.total > 0) {
    embed.setFooter({
      text: `Based on ${stats.checks24h.total} checks (24h) · ${stats.checks7d.total} checks (7d)`,
    });
  } else {
    embed.setFooter({
      text: 'No uptime data collected yet — stats populate over time',
    });
  }

  return embed;
}
