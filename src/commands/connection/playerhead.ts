import {
  SlashCommandBuilder,
  MessageFlags,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  ComponentType,
  type ChatInputCommandInteraction,
} from "discord.js";
import { getLinkedAccount } from "../../utils/linkUtils.js";
import { resolveServer } from "../../utils/guildRouter.js";
import { getOnlinePlayers } from "../../utils/playerUtils.js";
import {
  createErrorEmbed,
  createPlayerEmbed,
} from "../../utils/embedUtils.js";
import type { MojangProfile } from "../../types/index.js";

export const data = new SlashCommandBuilder()
  .setName("playerhead")
  .setDescription(
    "Get a player's head as an item (if you're linked and online)",
  )
  .addStringOption((opt) =>
    opt
      .setName("mcname")
      .setDescription("Minecraft username")
      .setRequired(true),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const mcname = interaction.options.getString("mcname", true);
  const userId = interaction.user.id;
  const server = resolveServer(interaction);

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

  const { name } = (await res.json()) as MojangProfile;

  const embed = createPlayerEmbed(name, {
    title: `${name}'s Head`,
    description: "Click the button below to receive this head in-game.",
  });

  const button = new ButtonBuilder()
    .setCustomId(`givehead_${mcname}`)
    .setLabel("🎁 Give to me")
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

  collector.on("collect", async (i) => {
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
        embeds: [createErrorEmbed("You must link your account first.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const onlinePlayers = await getOnlinePlayers(server);
    if (!onlinePlayers.includes(linkedUsername)) {
      await i.reply({
        embeds: [createErrorEmbed("You must be online in Minecraft.")],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await server.sendCommand(
      `give ${linkedUsername} player_head[profile={name:"${mcname}"}]`,
    );
    await i.reply({
      content: `✅ Given ${mcname}'s head to ${linkedUsername}.`,
      flags: MessageFlags.Ephemeral,
    });
  });
}
