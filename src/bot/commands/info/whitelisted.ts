import { SlashCommandBuilder } from "discord.js";
import {
  createEmbed,
  createInfoEmbed,
  createPaginationButtons,
  handlePagination,
} from "../../utils/embeds/embedUtils.js";
import { withErrorHandling } from "../middleware.js";
import { loadWhitelist } from "@mcbot/core/utils/minecraft/whitelist.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import { log } from "@mcbot/core/utils/logger.js";
import { CommandError, errMsg } from "@mcbot/core/utils/error.js";

import { t } from "@mcbot/core/utils/i18n.js";
export const data = new SlashCommandBuilder()
  .setName("whitelisted")
  .setDescription(
    "List all players who have been whitelisted on the Minecraft server",
  )
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

const NAMES_PER_PAGE = 20;

export const execute = withErrorHandling(async (interaction) => {
  const server = resolveServer(interaction);
  const players = await loadWhitelist(false, server).catch((err: unknown) => {
    log.error("whitelisted", errMsg(err));
    throw new CommandError({ problem: t("whitelisted.readFailed"), recovery: t("common.retryLater") });
  });

  if (!Array.isArray(players) || players.length === 0) {
    await interaction.editReply({
      embeds: [createInfoEmbed(t("whitelisted.empty"), { title: t("whitelisted.title", { server: server.id }) })],
    });
    return;
  }

  const usernames = players.map((p) => p.name).sort((a, b) => a.localeCompare(b));
  const title = t("whitelisted.title", { server: server.id });
  const total = t("whitelisted.total", { count: usernames.length });
  const embeds = [];
  for (let i = 0; i < usernames.length; i += NAMES_PER_PAGE) {
    const names = usernames.slice(i, i + NAMES_PER_PAGE).join(", ");
    embeds.push(createEmbed({ title, description: `${total}\n\n${names}` }));
  }

  const message = await interaction.editReply({
    embeds: [embeds[0]!],
    components: embeds.length > 1 ? [createPaginationButtons(0, embeds.length)] : [],
  });
  if (embeds.length > 1) await handlePagination(message, interaction, embeds);
});
