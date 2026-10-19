import { SlashCommandBuilder } from "discord.js";
import {
  createEmbed,
  createInfoEmbed,
} from "../../utils/embeds/embedUtils.js";
import { withErrorHandling } from "../middleware.js";
import { pageBy, replyPaged } from "../shared/paged.js";
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
  const embeds = pageBy(usernames, NAMES_PER_PAGE).map((names) =>
    createEmbed({ title, description: `${total}\n\n${names.join(", ")}` }),
  );
  await replyPaged(interaction, embeds);
});
