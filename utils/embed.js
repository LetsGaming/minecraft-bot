import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

const ITEMS_PER_PAGE = 25;

/**
 * Creates an embed for the current page of items.
 * @param {string} title The embed title
 * @param {Array<{name: string, value: string}>} items List of items to display (expects objects with name/value)
 * @param {number} page Current page index (0-based)
 * @returns {EmbedBuilder}
 */
export function createPaginatedEmbed(title, items, page) {
  const start = page * ITEMS_PER_PAGE;
  const pageItems = items.slice(start, start + ITEMS_PER_PAGE);

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(0x00bfff)
    .setTimestamp();

  pageItems.forEach(({ name, value }) => {
    embed.addFields({ name, value, inline: true });
  });

  embed.setFooter({
    text: `Page ${page + 1} of ${Math.ceil(items.length / ITEMS_PER_PAGE)}`,
  });

  return embed;
}

/**
 * Creates an action row with Previous and Next buttons.
 * @param {number} page Current page index (0-based)
 * @param {number} totalPages Total number of pages
 * @returns {ActionRowBuilder<ButtonBuilder>}
 */
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

/**
 * Handles pagination button interactions on the message.
 * @param {import('discord.js').Message} message The message containing the embed and buttons
 * @param {import('discord.js').Interaction} interaction The original command interaction
 * @param {string} title Title for the embed
 * @param {Array<{name: string, value: string}>} items The list of items to paginate
 */
export async function handlePagination(message, interaction, title, items) {
  const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
  let currentPage = 0;

  const collector = message.createMessageComponentCollector({
    filter: (i) => i.user.id === interaction.user.id,
    time: 120000, // 2 minutes
  });

  collector.on("collect", async (i) => {
    if (i.customId === "prev" && currentPage > 0) {
      currentPage--;
    } else if (i.customId === "next" && currentPage < totalPages - 1) {
      currentPage++;
    }

    const newEmbed = createPaginatedEmbed(title, items, currentPage);
    const newButtons = createPaginationButtons(currentPage, totalPages);

    await i.update({ embeds: [newEmbed], components: [newButtons] });
  });

  collector.on("end", async () => {
    // Disable buttons after timeout
    const disabledButtons = createPaginationButtons(currentPage, totalPages);
    disabledButtons.components.forEach((btn) => btn.setDisabled(true));
    try {
      await message.edit({ components: [disabledButtons] });
    } catch {
      // Message might be deleted or already updated
    }
  });
}
