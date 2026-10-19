import { SlashCommandBuilder } from "discord.js";
import { resolveServer } from "../utils/guild/guildRouter.js";

import { createSuccessEmbed } from "../utils/embeds/embedUtils.js";
import { withErrorHandling, requireServerAdmin } from "./middleware.js";
import { recordRemove } from "@mcbot/core/utils/stores/whitelistAudit.js";
import { invalidateWhitelistCache } from "@mcbot/core/utils/minecraft/whitelist.js";
import { playerConsoleCommand, requireMcName } from "./shared/mcName.js";
import {
  requireAccepted,
  withUnverifiedNote,
} from "@mcbot/core/utils/server/commandOutcome.js";

import { t } from "@mcbot/core/utils/i18n.js";
export const data = new SlashCommandBuilder()
  .setName("unwhitelist")
  .setDescription("Remove a player from the whitelist")
  .addStringOption((o) =>
    o
      .setName("username")
      .setDescription("Minecraft username")
      .setRequired(true),
  )
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

export const execute = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const username = requireMcName(interaction, "username");
    const server = resolveServer(interaction);

    const verdict = requireAccepted(
      await server.send(playerConsoleCommand(username, "/whitelist", { text: "remove" }, { player: username })),
      server.id,
    );
    await recordRemove(
      username,
      interaction.user.tag,
      interaction.user.id,
      server.id,
    );

    // Drop the cached whitelist so the removed player disappears
    // immediately instead of after a restart.
    invalidateWhitelistCache(server.id);

    await interaction.editReply({
      embeds: [
        createSuccessEmbed(
          withUnverifiedNote(
            t("whitelist.removed", { username, server: server.id }),
            verdict,
          ),
          { title: t("whitelist.removedTitle") },
        ),
      ],
    });
  }),
);
