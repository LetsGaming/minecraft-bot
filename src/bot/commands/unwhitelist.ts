import { SlashCommandBuilder } from "discord.js";
import { resolveServer } from "../utils/guild/guildRouter.js";

import { createSuccessEmbed } from "../utils/embeds/embedUtils.js";
import { withErrorHandling, requireServerAdmin } from "./middleware.js";
import { recordRemove } from "@mcbot/core/utils/stores/whitelistAudit.js";
import { invalidateWhitelistCache } from "@mcbot/core/utils/minecraft/whitelist.js";
import { isValidMcName } from "@mcbot/core/utils/sanitize.js";
import {
  requireAccepted,
  withUnverifiedNote,
} from "@mcbot/core/utils/server/commandOutcome.js";

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
    const username = interaction.options.getString("username", true);
    const server = resolveServer(interaction);
    // Never interpolate a raw username into a console command.
    if (!isValidMcName(username)) {
      throw new Error(`**${username}** is not a valid Minecraft username.`);
    }

    const verdict = requireAccepted(
      await server.send(`/whitelist remove ${username}`),
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
            `**${username}** has been removed from the whitelist on **${server.id}**.`,
            verdict,
          ),
        ),
      ],
    });
  }),
);
