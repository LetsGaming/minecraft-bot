import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embedUtils.js';
import { resolveServer } from '../../utils/guildRouter.js';

import { withErrorHandling } from '../middleware.js';

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Get the current status of a Minecraft server')
  .addStringOption((o) =>
    o.setName('server').setDescription('Server instance').setAutocomplete(true),
  );

export const execute = withErrorHandling(async (interaction) => {
  const sent = Date.now();
  const serverId = interaction.options.getString('server');
  const server = resolveServer(interaction);
  if (!server) throw new Error('Server not found.');

  const running = await server.isRunning();
  const botPing = interaction.client.ws.ping;
  const roundTrip = Date.now() - sent;

  if (!running) {
    const embed = createEmbed({
      title: `Server Status — ${server.id}`,
      description: '**Offline**',
    });
    embed.addFields(
      { name: 'Bot Ping', value: `${botPing}ms`, inline: true },
      { name: 'Round Trip', value: `${roundTrip}ms`, inline: true },
    );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const { playerCount, maxPlayers, players } = await server.getList();
  const embed = createEmbed({
    title: `Server Status — ${server.id}`,
    description: `**Online** — ${playerCount}/${maxPlayers} players`,
  });
  if (players.length > 0)
    embed.addFields({
      name: 'Online',
      value: players.join(', '),
      inline: false,
    });
  embed.addFields(
    { name: 'Bot Ping', value: `${botPing}ms`, inline: true },
    { name: 'Round Trip', value: `${roundTrip}ms`, inline: true },
  );

  await interaction.editReply({ embeds: [embed] });
});
