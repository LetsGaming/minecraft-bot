/**
 * /ban — moderation shortcut (admin).
 *
 * Deliberately thin: the reason is forwarded to the console (vanilla ban
 * list) and written to the admin audit log, nothing more. There is no
 * ban database of its own — `/note` already carries the per-player
 * "why" memory, and `/pardon` reverses this.
 */
import { SlashCommandBuilder } from "discord.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import { resolveServer } from "../../utils/guildRouter.js";
import { createSuccessEmbed } from "../../utils/embedUtils.js";
import { recordAdminAction } from "../../../common/utils/adminAudit.js";
import { isValidMcName } from "../../../common/utils/sanitize.js";
import { t } from "../../../common/utils/i18n.js";

import { MAX_REASON_LENGTH, sanitizeReason } from "./kick.js";

export const data = new SlashCommandBuilder()
  .setName("ban")
  .setDescription("Ban a player from the server | Admin only")
  .addStringOption((o) =>
    o
      .setName("player")
      .setDescription("Minecraft username")
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption((o) =>
    o
      .setName("reason")
      .setDescription("Stored in the ban list and the audit log")
      .setMaxLength(MAX_REASON_LENGTH),
  )
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

export const execute = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const player = interaction.options.getString("player", true).trim();
    if (!isValidMcName(player)) {
      throw new Error(t("common.invalidUsername", { username: player }));
    }
    const reason = sanitizeReason(interaction.options.getString("reason"));
    const server = resolveServer(interaction);

    await server.sendCommand(
      reason ? `/ban ${player} ${reason}` : `/ban ${player}`,
    );

    await recordAdminAction({
      action: "ban",
      server: server.id,
      by: interaction.user.tag,
      byId: interaction.user.id,
      guildId: interaction.guild?.id ?? null,
      detail: reason ? `${player}: ${reason}` : player,
    });

    await interaction.editReply({
      embeds: [
        createSuccessEmbed(
          t("moderation.banned", { player, server: server.id }),
        ),
      ],
    });
  }),
);
