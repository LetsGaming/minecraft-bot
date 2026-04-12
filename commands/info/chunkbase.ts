import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embedUtils.js';
import { getServerInstance, getGuildServer } from '../../utils/server.js';

import { getLinkedAccount } from '../../utils/linkUtils.js';
import { withErrorHandling } from '../middleware.js';

export const data = new SlashCommandBuilder()
  .setName('chunkbase')
  .setDescription("Get a Chunkbase link for the server's world seed")
  .addStringOption((o) =>
    o
      .setName('dimension')
      .setDescription('Dimension')
      .addChoices(
        { name: 'Overworld', value: 'overworld' },
        { name: 'Nether', value: 'nether' },
        { name: 'End', value: 'end' },
      ),
  )
  .addStringOption((o) =>
    o.setName('server').setDescription('Server instance').setAutocomplete(true),
  );

export const execute = withErrorHandling(async (interaction) => {
  const serverId = interaction.options.getString('server');
  const server = serverId
    ? getServerInstance(serverId)
    : getGuildServer(interaction.guild?.id);
  if (!server) throw new Error('Server not found.');

  const seed = await server.getSeed();
  if (!seed) throw new Error('Could not retrieve the world seed.');

  const dimension = interaction.options.getString('dimension') ?? 'overworld';
  const linked = await getLinkedAccount(interaction.user.id);

  let coordsParam = '';
  if (linked) {
    try {
      const coords = await server.getPlayerCoords(linked);
      if (coords)
        coordsParam = `&x=${Math.floor(coords.x)}&z=${Math.floor(coords.z)}`;
    } catch {
      /* proceed without */
    }
  }

  const url = `https://www.chunkbase.com/apps/seed-map#seed=${seed}&dimension=${dimension}${coordsParam}`;
  await interaction.editReply({
    embeds: [
      createEmbed({
        title: 'Chunkbase Map',
        description: `[Open Seed Map](${url})`,
        footer: { text: `${server.id} | ${interaction.user.tag}` },
      }),
    ],
  });
});
