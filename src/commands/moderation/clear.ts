import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';
import { createSuccessEmbed } from '../../utils/embedUtils.js';
import { withErrorHandling } from '../middleware.js';
import { log } from '../../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('clear')
  .setDescription('Bulk-delete the last X messages from this channel')
  .addIntegerOption((o) =>
    o
      .setName('amount')
      .setDescription('Number of messages to delete (1–100)')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

export const execute = withErrorHandling(
  async (interaction) => {
    const amount = interaction.options.getInteger('amount', true);
    const channel = interaction.channel as TextChannel | null;

    if (!channel || !('bulkDelete' in channel)) {
      throw new Error('This command can only be used in a text channel.');
    }

    const deleted = await channel.bulkDelete(amount, true);

    log.info(
      'clear',
      `${interaction.user.tag} cleared ${deleted.size} message(s) in #${channel.name}`,
    );

    const embed = createSuccessEmbed(
      `Deleted **${deleted.size}** message(s).` +
        (deleted.size < amount
          ? `\n_Messages older than 14 days cannot be bulk-deleted._`
          : ''),
    );
    await interaction.editReply({ embeds: [embed] });
  },
  { defer: true, ephemeral: true },
);
