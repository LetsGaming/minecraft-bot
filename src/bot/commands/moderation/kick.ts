/**
 * /kick — moderation shortcut (admin).
 *
 * Deliberately thin: the reason is forwarded to the console and written
 * to the admin audit log, nothing more. There is no ban database of its
 * own — `/note` already carries the per-player "why" memory.
 */
import { SlashCommandBuilder } from "discord.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import { createSuccessEmbed } from "../../utils/embeds/embedUtils.js";
import { recordAdminAction } from "@mcbot/core/utils/stores/adminAudit.js";
import {
  isValidMcName,
  sanitizeReason,
  MAX_REASON_LENGTH,
} from "@mcbot/core/utils/sanitize.js";
import { t } from "@mcbot/core/utils/i18n.js";
import {
  requireAccepted,
  withUnverifiedNote,
} from "@mcbot/core/utils/server/commandOutcome.js";

export const data = new SlashCommandBuilder()
  .setName("kick")
  .setDescription("Kick a player from the server | Admin only")
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
      .setDescription("Shown to the player and written to the audit log")
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

    const verdict = requireAccepted(
      await server.send(
        reason ? `/kick ${player} ${reason}` : `/kick ${player}`,
      ),
      server.id,
      { refusal: /^No player was found/i },
    );

    await recordAdminAction({
      action: "kick",
      server: server.id,
      by: interaction.user.tag,
      byId: interaction.user.id,
      guildId: interaction.guild?.id ?? null,
      detail: reason ? `${player}: ${reason}` : player,
    });

    await interaction.editReply({
      embeds: [
        createSuccessEmbed(
          withUnverifiedNote(
            t("moderation.kicked", { player, server: server.id }),
            verdict,
          ),
          { title: t("moderation.kickedTitle") },
        ),
      ],
    });
  }),
);
