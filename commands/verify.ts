import { SlashCommandBuilder } from 'discord.js';
import { resolveServer } from '../utils/guildRouter.js';

import { createSuccessEmbed } from '../utils/embedUtils.js';
import { withErrorHandling, requireServerAdmin } from './middleware.js';
import { recordAdd } from '../utils/whitelistAudit.js';
import type { MojangProfile } from '../types/index.js';

export const data = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Verify a Minecraft username and whitelist it')
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
    const serverId = interaction.options.getString('server');
    const server = resolveServer(interaction);
    if (!server) throw new Error('Server not found.');

    const res = await fetch(
      `https://api.mojang.com/users/profiles/minecraft/${username}`,
    );
    if (!res.ok) throw new Error(`Username **${username}** not found.`);

    const profile = (await res.json()) as MojangProfile;

    await server.sendCommand(`/whitelist add ${username}`);
    await recordAdd(
      username,
      interaction.user.tag,
      interaction.user.id,
      server.id,
      profile.id,
    );

    await interaction.editReply({
      embeds: [
        createSuccessEmbed(
          `**${username}** has been whitelisted on **${server.id}**.`,
        ),
      ],
    });
  }),
);
