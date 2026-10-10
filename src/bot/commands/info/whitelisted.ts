import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  createEmbed,
  createErrorEmbed,
  createPaginationButtons,
  handlePagination,
} from "../../utils/embeds/embedUtils.js";
import { loadWhitelist } from "@mcbot/core/utils/minecraft/whitelist.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";

import { t } from "@mcbot/core/utils/i18n.js";
export const data = new SlashCommandBuilder()
  .setName("whitelisted")
  .setDescription(
    "List all players who have been whitelisted on the Minecraft server",
  )
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply();
  const guildId = interaction.guildId ?? undefined;

  try {
    const server = resolveServer(interaction);
    const players = await loadWhitelist(false, server);

    if (!Array.isArray(players) || players.length === 0) {
      await interaction.editReply({
        content: t("whitelisted.empty", {}, guildId),
      });
      return;
    }

    const usernames = players
      .map((p) => p.name)
      .sort((a, b) => a.localeCompare(b));

    const chunkSize = 20;
    const totalPages = Math.ceil(usernames.length / chunkSize);
    const embeds = [];

    for (let i = 0; i < totalPages; i++) {
      const page = usernames.slice(i * chunkSize, (i + 1) * chunkSize);
      const embed = createEmbed({
        title: t("whitelisted.title", {}, guildId),
      })
        .addFields({
          name: t("whitelisted.page", { page: i + 1 }, guildId),
          value: page.join(", "),
        })
        .setFooter({ text: t("whitelisted.total", { count: usernames.length }, guildId) });

      embeds.push(embed);
    }

    const message = await interaction.editReply({
      embeds: [embeds[0]!],
      components:
        totalPages > 1 ? [createPaginationButtons(0, totalPages)] : [],
    });

    if (totalPages > 1) {
      await handlePagination(message, interaction, embeds);
    }
  } catch (err) {
    log.error("whitelisted", errMsg(err));
    await interaction.editReply({
      embeds: [createErrorEmbed(t("whitelisted.readFailed", {}, guildId))],
    });
  }
}
