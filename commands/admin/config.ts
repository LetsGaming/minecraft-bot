import { SlashCommandBuilder, codeBlock } from 'discord.js';
import { loadConfig, reloadConfig, getServerIds } from '../../config.js';
import { createEmbed, createSuccessEmbed } from '../../utils/embedUtils.js';
import { withErrorHandling, requireServerAdmin } from '../middleware.js';
import { log } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('View or reload the bot configuration')
  .addSubcommand((sub) =>
    sub.setName('show').setDescription('Show the current running configuration'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('reload')
      .setDescription('Reload config.json from disk (hot-reload)'),
  );

/**
 * Redact sensitive values so they can be shown in Discord safely.
 */
function redact(value: string): string {
  if (!value || value.length <= 4) return '••••';
  return value.slice(0, 2) + '•'.repeat(value.length - 4) + value.slice(-2);
}

export const execute = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const sub = interaction.options.getSubcommand();

    if (sub === 'reload') {
      const before = getServerIds();
      const cfg = reloadConfig();
      const after = Object.keys(cfg.servers);

      log.info('config', `Config reloaded by ${interaction.user.tag}`);

      const lines = [
        `Servers: ${after.join(', ')}`,
        `Guilds: ${Object.keys(cfg.guilds).length}`,
        `Admins: ${cfg.adminUsers.length}`,
      ];

      const added = after.filter((s) => !before.includes(s));
      const removed = before.filter((s) => !after.includes(s));
      if (added.length > 0) lines.push(`+ Added: ${added.join(', ')}`);
      if (removed.length > 0) lines.push(`- Removed: ${removed.join(', ')}`);

      await interaction.editReply({
        embeds: [
          createSuccessEmbed(
            `Config reloaded from disk.\n${codeBlock(lines.join('\n'))}`,
          ),
        ],
      });
      return;
    }

    // ── show ──
    const cfg = loadConfig();

    // Servers overview
    const serverLines = Object.entries(cfg.servers).map(([id, srv]) => {
      const rcon = srv.useRcon
        ? `RCON ${srv.rconHost}:${srv.rconPort}`
        : 'screen only';
      return `${id}: ${rcon} (user: ${srv.linuxUser})`;
    });

    // Guild overview
    const guildLines = Object.entries(cfg.guilds).map(([guildId, gcfg]) => {
      const features: string[] = [];
      if (gcfg.statusEmbed?.channelId) features.push('status');
      if (gcfg.notifications?.channelId) features.push('notifications');
      if (gcfg.chatBridge?.channelId) features.push('chatBridge');
      if (gcfg.leaderboard?.channelId) features.push('leaderboard');
      if (gcfg.downtimeAlerts?.channelId) features.push('downtime');
      if (gcfg.tpsAlerts?.channelId) features.push('tpsAlerts');
      if (gcfg.channelPurge?.channelId) features.push('purge');
      const defaultSrv = gcfg.defaultServer ? ` → ${gcfg.defaultServer}` : '';
      return `${guildId}${defaultSrv}\n  ${features.length > 0 ? features.join(', ') : 'no features configured'}`;
    });

    // Commands overview
    const disabledCmds = Object.entries(cfg.commands)
      .filter(([, v]) => v.enabled === false)
      .map(([k]) => k);

    const embed = createEmbed({
      title: '⚙️ Bot Configuration',
      color: 0x5865f2,
    });

    embed.addFields(
      {
        name: 'Token',
        value: codeBlock(redact(cfg.token)),
        inline: true,
      },
      {
        name: 'Client ID',
        value: codeBlock(cfg.clientId),
        inline: true,
      },
      {
        name: `Servers (${Object.keys(cfg.servers).length})`,
        value: codeBlock(serverLines.join('\n') || 'none'),
        inline: false,
      },
      {
        name: `Guilds (${Object.keys(cfg.guilds).length})`,
        value: codeBlock(guildLines.join('\n') || 'none'),
        inline: false,
      },
      {
        name: `Admins (${cfg.adminUsers.length})`,
        value: codeBlock(cfg.adminUsers.map(redact).join(', ') || 'none'),
        inline: true,
      },
    );

    if (disabledCmds.length > 0) {
      embed.addFields({
        name: 'Disabled Commands',
        value: codeBlock(disabledCmds.join(', ')),
        inline: true,
      });
    }

    embed.addFields(
      {
        name: 'TPS Threshold',
        value: `${cfg.tpsWarningThreshold}`,
        inline: true,
      },
      {
        name: 'TPS Poll Interval',
        value: `${cfg.tpsPollIntervalMs / 1000}s`,
        inline: true,
      },
      {
        name: 'Leaderboard Interval',
        value: cfg.leaderboardInterval,
        inline: true,
      },
    );

    embed.setFooter({ text: 'Use /config reload to apply config.json changes' });

    await interaction.editReply({ embeds: [embed] });
  }),
);
