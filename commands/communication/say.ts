import { SlashCommandBuilder } from 'discord.js';
import { resolveServer } from '../../utils/guildRouter.js';

import { withErrorHandling } from '../middleware.js';

export const data = new SlashCommandBuilder()
  .setName('say')
  .setDescription('Send a message to the Minecraft server chat')
  .addStringOption((o) =>
    o.setName('message').setDescription('Message to send').setRequired(true),
  )
  .addStringOption((o) =>
    o.setName('server').setDescription('Server instance').setAutocomplete(true),
  );

export const execute = withErrorHandling(
  async (interaction) => {
    const message = interaction.options.getString('message', true);
    const serverId = interaction.options.getString('server');
    const server = resolveServer(interaction);
    if (!server) throw new Error('Server not found.');

    const mcMessage = `[${interaction.user.displayName}] ${message}`;
    await server.sendCommand(`/say ${mcMessage}`);
    await interaction.editReply(`✅ Sent to **${server.id}**: "${mcMessage}"`);
  },
  { ephemeral: true },
);
