import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
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
