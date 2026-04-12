import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embedUtils.js';
import { getServerInstance, getGuildServer } from '../../utils/server.js';

import { withErrorHandling } from '../middleware.js';
import fs from 'fs';
import path from 'path';

export const data = new SlashCommandBuilder()
  .setName('backup')
  .setDescription('Show backup status for a server')
  .addStringOption((o) =>
    o.setName('server').setDescription('Server instance').setAutocomplete(true),
  );

export const execute = withErrorHandling(async (interaction) => {
  const serverId = interaction.options.getString('server');
  const server = serverId
    ? getServerInstance(serverId)
    : getGuildServer(interaction.guild?.id);
  if (!server) throw new Error('Server not found.');

  const backupsBase = path.resolve(
    server.config.serverDir,
    '..',
    'backups',
    server.config.screenSession,
  );
  const dirs = [
    'hourly',
    'archives/daily',
    'archives/weekly',
    'archives/monthly',
    'archives/update',
  ];

  interface BackupField {
    name: string;
    value: string;
    inline: boolean;
  }

  const fields: BackupField[] = [];
  let totalSize = 0;

  for (const dir of dirs) {
    const fullDir = path.join(backupsBase, dir);
    if (!fs.existsSync(fullDir)) continue;

    const files = fs
      .readdirSync(fullDir)
      .filter((f) => f.endsWith('.tar.zst') || f.endsWith('.tar.gz'));
    if (files.length === 0) continue;

    files.sort().reverse();
    const latest = files[0]!;
    const stat = fs.statSync(path.join(fullDir, latest));
    const sizeMb = (stat.size / 1048576).toFixed(1);
    const age = getAge(stat.mtime);
    totalSize += stat.size;

    fields.push({
      name: dir.replace('archives/', '📁 '),
      value: `${files.length} backup(s)\nLatest: ${age} ago (${sizeMb} MB)`,
      inline: true,
    });
  }

  if (fields.length === 0) throw new Error('No backups found.');

  const embed = createEmbed({
    title: `💾 Backup Status — ${server.id}`,
    description: `Total: ${(totalSize / 1073741824).toFixed(2)} GB`,
  });
  embed.addFields(fields);

  await interaction.editReply({ embeds: [embed] });
});

function getAge(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
