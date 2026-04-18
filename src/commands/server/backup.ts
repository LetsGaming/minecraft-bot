import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embedUtils.js';
import { resolveServer } from '../../utils/guildRouter.js';
import { withErrorHandling } from '../middleware.js';
import * as serverAccess from '../../utils/serverAccess.js';

export const data = new SlashCommandBuilder()
  .setName('backup')
  .setDescription('Show backup status for a server')
  .addStringOption((o) =>
    o.setName('server').setDescription('Server instance').setAutocomplete(true),
  );

export const execute = withErrorHandling(async (interaction) => {
  const server = resolveServer(interaction);
  if (!server) throw new Error('Server not found.');

  const { dirs, totalBytes } = await serverAccess.readBackups(server.config);

  if (dirs.length === 0) throw new Error('No backups found.');

  const embed = createEmbed({
    title: `💾 Backup Status — ${server.id}`,
    description: `Total: ${(totalBytes / 1073741824).toFixed(2)} GB`,
  });

  for (const b of dirs) {
    const sizeMb = (b.latestSizeBytes / 1048576).toFixed(1);
    const age = getAge(b.latestMtime);
    embed.addFields({
      name: b.dir.replace('archives/', '📁 '),
      value: `${b.count} backup(s)\nLatest: ${age} ago (${sizeMb} MB)`,
      inline: true,
    });
  }

  await interaction.editReply({ embeds: [embed] });
});

function getAge(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

