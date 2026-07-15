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
  stripControlChars,
} from "@mcbot/core/utils/sanitize.js";
import { t } from "@mcbot/core/utils/i18n.js";

/** Console commands cap at 256 chars; leave room for name + verb. */
export const MAX_REASON_LENGTH = 160;

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

/** Shared sanitizer for the three moderation commands. */
export function sanitizeReason(raw: string | null): string {
  return stripControlChars(raw ?? "").slice(0, MAX_REASON_LENGTH).trim();
}

export const execute = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const player = interaction.options.getString("player", true).trim();
    if (!isValidMcName(player)) {
      throw new Error(t("common.invalidUsername", { username: player }));
    }
    const reason = sanitizeReason(interaction.options.getString("reason"));
    const server = resolveServer(interaction);

    await server.sendCommand(
      reason ? `/kick ${player} ${reason}` : `/kick ${player}`,
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
          t("moderation.kicked", { player, server: server.id }),
        ),
      ],
    });
  }),
);
