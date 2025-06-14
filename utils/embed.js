import { EmbedBuilder } from "discord.js";

const DEFAULT_ITEMS_PER_PAGE = 20;
const DEFAULT_COLOR = 0x00bfff;

/**
 * Creates a paginated embed for an array of items.
 * @param {string} title - Embed title
 * @param {Array} items - Array of items to paginate
 * @param {number} page - zero-based page index
 * @param {function} formatItem - (item) => {name, value, inline} object for each embed field
 * @param {object} [options]
 * @param {number} [options.itemsPerPage=20]
 * @param {number} [options.color=0x00bfff]
 * @returns {EmbedBuilder}
 */
export function paginateEmbed(title, items, page, formatItem, options = {}) {
  const itemsPerPage = options.itemsPerPage ?? DEFAULT_ITEMS_PER_PAGE;
  const color = options.color ?? DEFAULT_COLOR;
  const totalPages = Math.ceil(items.length / itemsPerPage);
  const start = page * itemsPerPage;
  const end = start + itemsPerPage;
  const pageItems = items.slice(start, end);

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setTimestamp()
    .setFooter({ text: `Page ${page + 1} of ${totalPages}` });

  for (const item of pageItems) {
    const field = formatItem(item);
    if (field && field.name && field.value) {
      embed.addFields(field);
    }
  }

  return embed;
}
