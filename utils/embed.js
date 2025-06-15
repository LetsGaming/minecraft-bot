import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ComponentType,
} from "discord.js";

export function createEmbed({ title, color = 0x00bfff, timestamp = true }) {
  const embed = new EmbedBuilder().setTitle(title).setColor(color);
  if (timestamp) embed.setTimestamp();
  return embed;
}

export function createPaginationButtons(page, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("prev")
      .setLabel("Previous")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page <= 0),

    new ButtonBuilder()
      .setCustomId("next")
      .setLabel("Next")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= totalPages - 1)
  );
}

export async function handlePagination(message, interaction, embeds) {
  let page = 0;
  const totalPages = embeds.length;

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 60_000, // 60 seconds
  });

  collector.on("collect", async (i) => {
    if (i.user.id !== interaction.user.id) {
      return i.reply({
        content: "These buttons aren't for you.",
        ephemeral: true,
      });
    }

    if (i.customId === "prev" && page > 0) page--;
    if (i.customId === "next" && page < totalPages - 1) page++;

    await i.update({
      embeds: [embeds[page]],
      components: [createPaginationButtons(page, totalPages)],
    });
  });

  collector.on("end", async () => {
    try {
      await message.edit({ components: [] });
    } catch (err) {
      console.warn(
        "Failed to remove buttons after pagination timeout:",
        err.message
      );
    }
  });
}
