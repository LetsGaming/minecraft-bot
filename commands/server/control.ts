import { SlashCommandBuilder } from 'discord.js';
import {
  createEmbed,
  createErrorEmbed,
  createSuccessEmbed,
} from '../../utils/embedUtils.js';
import { getServerInstance, getGuildServer } from '../../utils/server.js';

import { withErrorHandling, requireServerAdmin } from '../middleware.js';
import { execCommand } from '../../shell/execCommand.js';
import { suppressAlerts } from '../../logWatcher/watchers/downtimeMonitor.js';
import { log } from '../../utils/logger.js';

const SCRIPT_MAP: Record<string, string> = {
  start: 'start.sh',
  stop: 'shutdown.sh',
  restart: 'smart_restart.sh',
};

export const data = new SlashCommandBuilder()
  .setName('server')
  .setDescription('Server control commands')
  .addSubcommand((sub) =>
    sub
      .setName('start')
      .setDescription('Start the server')
      .addStringOption((o) =>
        o
          .setName('server')
          .setDescription('Server instance')
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('stop')
      .setDescription('Stop the server')
      .addStringOption((o) =>
        o
          .setName('server')
          .setDescription('Server instance')
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('restart')
      .setDescription('Restart the server')
      .addStringOption((o) =>
        o
          .setName('server')
          .setDescription('Server instance')
          .setAutocomplete(true),
      ),
  );

export const execute = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const sub = interaction.options.getSubcommand();
    const serverId = interaction.options.getString('server');
    const server = serverId
      ? getServerInstance(serverId)
      : getGuildServer(interaction.guild?.id);

    if (!server) throw new Error('Server not found.');

    // Suppress downtime alerts for intentional stop/restart
    if (sub === 'stop' || sub === 'restart') {
      suppressAlerts(server.id);
    }

    const scriptDir = server.config.scriptDir || server.config.serverDir;
    const scriptName = SCRIPT_MAP[sub];
    if (!scriptName) throw new Error(`Unknown subcommand: ${sub}`);
    const script = `${scriptDir}/${scriptName}`;

    log.info('control', `${interaction.user.tag} → ${sub} on ${server.id}`);
    await interaction.editReply({
      embeds: [
        createEmbed({
          title: `⏳ ${sub}...`,
          description: `Executing ${sub} on **${server.id}**...`,
        }),
      ],
    });

    try {
      await execCommand(`bash "${script}"`);
      await interaction.editReply({
        embeds: [
          createSuccessEmbed(`Server **${server.id}** — ${sub} complete.`),
        ],
      });
    } catch (err) {
      await interaction.editReply({
        embeds: [createErrorEmbed(`${sub} failed: ${err}`)],
      });
    }
  }),
);
