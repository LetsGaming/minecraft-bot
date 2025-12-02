import {
  SlashCommandBuilder,
  MessageFlags,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  ComponentType,
} from "discord.js";
import { getLinkedAccount } from "../../utils/linkUtils.js";
import { sendToServer } from "../../utils/utils.js";
import { getOnlinePlayers } from "../../utils/playerUtils.js";
import {
  createErrorEmbed,
  createEmbedWithThumbnail,
} from "../../utils/embedUtils.js";

export const data = new SlashCommandBuilder()
  .setName("playerhead")
  .setDescription(
    "Get a player's head as an item (if you're linked and online)"
  )
  .addStringOption((opt) =>
    opt.setName("mcname").setDescription("Minecraft username").setRequired(true)
  );

export async function execute(interaction) {
  const mcname = interaction.options.getString("mcname");
  const userId = interaction.user.id;

  const res = await fetch(
    `https://api.mojang.com/users/profiles/minecraft/${mcname}` // Mojang API to get UUID by username
  );
  if (!res.ok) {
    return interaction.reply({
      embeds: [createErrorEmbed(`Player \`${mcname}\` not found.`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  const { id: uuid } = await res.json();

  const skinUrl = `https://crafatar.com/avatars/${uuid}?overlay&size=128`; // fallback to head-only avatar

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
    .setLabel("🎁 Give to me")
    .setStyle(ButtonStyle.Success);

  const row = new ActionRowBuilder().addComponents(button);

  await interaction.reply({
    embeds: [embed],
    components: [row],
  });

  const replyMessage = await interaction.fetchReply();

  const collector = replyMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 30_000,
  });

  collector.on("collect", async (i) => {
    if (i.customId !== `givehead_${mcname}`) return;

    if (i.user.id !== userId) {
      return i.reply({
        content: "This isn't your button.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const linkedUsername = await getLinkedAccount(userId);
    if (!linkedUsername) {
      return i.reply({
        embeds: [createErrorEmbed("You must link your account first.")],
        flags: MessageFlags.Ephemeral,
      });
    }

    const onlinePlayers = await getOnlinePlayers();
    if (!onlinePlayers.includes(linkedUsername)) {
      return i.reply({
        embeds: [createErrorEmbed("You must be online in Minecraft.")],
        flags: MessageFlags.Ephemeral,
      });
    }

    await sendToServer(
      `give ${linkedUsername} player_head[profile={name:"${playerHeadName}"}]`
    );
    return i.reply({
      content: `✅ Given ${mcname}'s head to ${linkedUsername}.`,
      flags: MessageFlags.Ephemeral,
    });
  });
}
