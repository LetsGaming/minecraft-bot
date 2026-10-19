/**
 * /pardon — moderation shortcut (admin).
 *
 * Removes a player from the vanilla ban list; the action lands in the
 * admin audit log like /kick and /ban. A pending timed-ban release for
 * the same player is dropped too, so the scheduler doesn't fire a second
 * pardon later (harmless, but it would pollute the audit log).
 */
import { SlashCommandBuilder } from "discord.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import { createSuccessEmbed } from "../../utils/embeds/embedUtils.js";
import { auditAdminAction } from "../shared/audit.js";
import { playerConsoleCommand, requireMcName } from "../shared/mcName.js";
import { removeTempBan } from "@mcbot/core/utils/stores/tempBanStore.js";
import { cancelTempBanTimer } from "../../logWatcher/watchers/schedulers/tempBanScheduler.js";
import { t } from "@mcbot/core/utils/i18n.js";
import {
  requireAccepted,
  withUnverifiedNote,
} from "@mcbot/core/utils/server/commandOutcome.js";

export const data = new SlashCommandBuilder()
  .setName("pardon")
  .setDescription("Unban a player | Admin only")
  .addStringOption((o) =>
    o
      .setName("player")
      .setDescription("Minecraft username")
      .setRequired(true),
  )
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

export const execute = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const player = requireMcName(interaction, "player");
    const server = resolveServer(interaction);

    const verdict = requireAccepted(
      await server.send(playerConsoleCommand(player, "/pardon", { player })),
      server.id,
    );

    cancelTempBanTimer(server.id, player);
    await removeTempBan(server.id, player);

    await auditAdminAction(interaction, {
      action: "pardon",
      server: server.id,
      detail: player,
    });

    await interaction.editReply({
      embeds: [
        createSuccessEmbed(
          withUnverifiedNote(
            t("moderation.pardoned", { player, server: server.id }),
            verdict,
          ),
          { title: t("moderation.pardonedTitle") },
        ),
      ],
    });
  }),
);
