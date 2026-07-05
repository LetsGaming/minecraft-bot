/**
 * /pardon — moderation shortcut (admin).
 *
 * Removes a player from the vanilla ban list; the action lands in the
 * admin audit log like /kick and /ban.
 */
import { SlashCommandBuilder } from "discord.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import { resolveServer } from "../../utils/guildRouter.js";
import { createSuccessEmbed } from "../../utils/embedUtils.js";
import { recordAdminAction } from "../../../common/utils/adminAudit.js";
import { isValidMcName } from "../../../common/utils/sanitize.js";
import { t } from "../../../common/utils/i18n.js";

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
    const player = interaction.options.getString("player", true).trim();
    if (!isValidMcName(player)) {
      throw new Error(t("common.invalidUsername", { username: player }));
    }
    const server = resolveServer(interaction);

    await server.sendCommand(`/pardon ${player}`);

    await recordAdminAction({
      action: "pardon",
      server: server.id,
      by: interaction.user.tag,
      byId: interaction.user.id,
      guildId: interaction.guild?.id ?? null,
      detail: player,
    });

    await interaction.editReply({
      embeds: [
        createSuccessEmbed(
          t("moderation.pardoned", { player, server: server.id }),
        ),
      ],
    });
  }),
);
