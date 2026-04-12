import {
  SlashCommandBuilder,
  MessageFlags,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  ComponentType,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { getLinkedAccount } from '../../utils/linkUtils.js';
import { sendToServer } from '../../utils/server.js';
import { getOnlinePlayers } from '../../utils/playerUtils.js';
import {
  createErrorEmbed,
  createEmbedWithThumbnail,
} from '../../utils/embedUtils.js';
import type { MojangProfile } from '../../types/index.js';

export const data = new SlashCommandBuilder()
  .setName('playerhead')
  .setDescription(
    "Get a player's head as an item (if you're linked and online)",
  )
  .addStringOption((opt) =>
    opt
      .setName('mcname')
      .setDescription('Minecraft username')
      .setRequired(true),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const mcname = interaction.options.getString('mcname', true);
  const userId = interaction.user.id;

  const res = await fetch(
    `https://api.mojang.com/users/profiles/minecraft/${mcname}`,
  );
  if (!res.ok) {
    await interaction.reply({
      embeds: [createErrorEmbed(`Player \`${mcname}\` not found.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { id: uuid } = (await res.json()) as MojangProfile;

  const skinUrl = `https://crafatar.com/avatars/${uuid}?overlay&size=128`;

  const embed = createEmbedWithThumbnail({
    title: `${mcname}'s Player Head`,
    description:
      "Click the button to receive this head in-game (if you're linked and online).",
    thumbnail: skinUrl,
    footer: { text: `Requested by ${interaction.user.tag}` },
    timestamp: true,
  });

  const button = new ButtonBuilder()
    .setCustomId(`givehead_${mcname}`)
    .setLabel('🎁 Give to me')
    .setStyle(ButtonStyle.Success);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

  await interaction.reply({
    embeds: [embed],
    components: [row],
  });

  const replyMessage = await interaction.fetchReply();

  const collector = replyMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 30_000,
  });

  collector.on('collect', async (i) => {
    if (i.customId !== `givehead_${mcname}`) return;

    if (i.user.id !== userId) {
      await i.reply({
        content: "This isn't your button.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const linkedUsername = await getLinkedAccount(userId);
    if (!linkedUsername) {
      await i.reply({
        embeds: [createErrorEmbed('You must link your account first.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const onlinePlayers = await getOnlinePlayers();
    if (!onlinePlayers.includes(linkedUsername)) {
      await i.reply({
        embeds: [createErrorEmbed('You must be online in Minecraft.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await sendToServer(
      `give ${linkedUsername} player_head[profile={name:"${mcname}"}]`,
    );
    await i.reply({
      content: `✅ Given ${mcname}'s head to ${linkedUsername}.`,
      flags: MessageFlags.Ephemeral,
    });
  });
}
