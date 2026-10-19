import type { ChatInputCommandInteraction, EmbedBuilder } from "discord.js";
import {
  createPaginationButtons,
  handlePagination,
} from "../../utils/embeds/embedUtils.js";

/** Splits `items` into consecutive pages of at most `pageSize`. */
export function pageBy<T>(items: readonly T[], pageSize: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += pageSize) {
    pages.push(items.slice(i, i + pageSize));
  }
  return pages;
}

/** Sends `embeds` as the (already deferred) reply, with a pager when there is more than one. */
export async function replyPaged(
  interaction: ChatInputCommandInteraction,
  embeds: EmbedBuilder[],
): Promise<void> {
  if (embeds.length === 1) {
    await interaction.editReply({ embeds });
    return;
  }
  const message = await interaction.editReply({
    embeds: [embeds[0]!],
    components: [createPaginationButtons(0, embeds.length)],
  });
  await handlePagination(message, interaction, embeds);
}
