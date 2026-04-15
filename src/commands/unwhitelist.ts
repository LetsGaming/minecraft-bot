import { SlashCommandBuilder } from 'discord.js';
import { resolveServer } from '../utils/guildRouter.js';

import { createSuccessEmbed } from '../utils/embedUtils.js';
import { withErrorHandling, requireServerAdmin } from './middleware.js';
import { recordRemove } from '../utils/whitelistAudit.js';

export const data = new SlashCommandBuilder()
  .setName('unwhitelist')
  .setDescription('Remove a player from the whitelist')
  .addStringOption((o) =>
    o
      .setName('username')
      .setDescription('Minecraft username')
      .setRequired(true),
  )
  .addStringOption((o) =>
    o.setName('server').setDescription('Server instance').setAutocomplete(true),
  );

export const execute = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const username = interaction.options.getString('username', true);
    const server = resolveServer(interaction);
    if (!server) throw new Error('Server not found.');

    await server.sendCommand(`/whitelist remove ${username}`);
    await recordRemove(
      username,
      interaction.user.tag,
      interaction.user.id,
      server.id,
    );

    await interaction.editReply({
      embeds: [
        createSuccessEmbed(
          `**${username}** has been removed from the whitelist on **${server.id}**.`,
        ),
      ],
    });
  }),
);
