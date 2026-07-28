/**
 * /ban — moderation shortcut (admin).
 *
 * Deliberately thin: the reason is forwarded to the console (vanilla ban
 * list) and written to the admin audit log, nothing more. There is no
 * ban database of its own — `/note` already carries the per-player
 * "why" memory, and `/pardon` reverses this.
 *
 * The optional `duration` ("30m", "3d", "1.5y") makes it a timed ban.
 * Minecraft itself has no expiry, so the ban stays a plain vanilla ban
 * and only the release is scheduled bot-side (see tempBanStore /
 * tempBanScheduler). Omitting the duration keeps the old behaviour:
 * permanent until someone runs /pardon.
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
import {
  parseDuration,
  formatDuration,
} from "@mcbot/core/utils/duration.js";
import {
  putTempBan,
  type TempBan,
} from "@mcbot/core/utils/stores/tempBanStore.js";
import { armTempBan } from "../../logWatcher/watchers/schedulers/tempBanScheduler.js";
import { t } from "@mcbot/core/utils/i18n.js";

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
      .setName("duration")
      .setDescription(
        "How long, e.g. 30m, 2h, 3d, 1w, 2mo, 1.5y — omit for permanent",
      ),
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

    const rawDuration = interaction.options.getString("duration");
    const durationMs = rawDuration === null ? null : parseDuration(rawDuration);
    if (rawDuration !== null && durationMs === null) {
      throw new Error(t("moderation.invalidDuration", { input: rawDuration }));
    }

    const server = resolveServer(interaction);

    // The console reason doubles as the message the player sees on their
    // next join attempt, so tell them it ends.
    const expiresAt = durationMs === null ? null : Date.now() + durationMs;
    const period = durationMs === null ? null : formatDuration(durationMs);
    const consoleReason = period
      ? reason
        ? `${reason} (${period})`
        : `Temporarily banned (${period})`
      : reason;

    await server.sendCommand(
      consoleReason ? `/ban ${player} ${consoleReason}` : `/ban ${player}`,
    );

    if (expiresAt !== null) {
      const ban: TempBan = {
        player,
        serverId: server.id,
        expiresAt,
        bannedAt: Date.now(),
        by: interaction.user.tag,
        reason,
      };
      await putTempBan(ban);
      armTempBan(interaction.client, ban);
    }

    await recordAdminAction({
      action: expiresAt === null ? "ban" : "tempban",
      server: server.id,
      by: interaction.user.tag,
      byId: interaction.user.id,
      guildId: interaction.guild?.id ?? null,
      detail: [player, period, reason].filter(Boolean).join(" | "),
    });

    const message =
      expiresAt === null || period === null
        ? t("moderation.banned", { player, server: server.id })
        : t("moderation.bannedTemp", {
            player,
            server: server.id,
            duration: period,
            until: `<t:${Math.floor(expiresAt / 1000)}:f>`,
          });

    await interaction.editReply({ embeds: [createSuccessEmbed(message)] });
  }),
);
