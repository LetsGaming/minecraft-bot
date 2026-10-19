import { SlashCommandBuilder } from "discord.js";
import { createInfoEmbed, createSuccessEmbed } from "../../utils/embeds/embedUtils.js";
import { withErrorHandling } from "../middleware.js";
import { unlinkAccount } from "@mcbot/core/utils/stores/linkUtils.js";
import { syncLinkedRole } from "../../utils/guild/linkedRole.js";

import { t } from "@mcbot/core/utils/i18n.js";
export const data = new SlashCommandBuilder()
  .setName("unlink")
  .setDescription("Unlink your Discord account from your Minecraft account");

export const execute = withErrorHandling(
  async (interaction) => {
    const userId = interaction.user.id;
    const removed = await unlinkAccount(userId);
    if (!removed) {
      await interaction.editReply({ embeds: [createInfoEmbed(t("link.notLinked"))] });
      return;
    }

    await syncLinkedRole(interaction.client, userId, "remove");
    await interaction.editReply({
      embeds: [createSuccessEmbed(t("link.unlinked"), { title: t("link.unlinkedTitle") })],
    });
  },
  { ephemeral: true },
);
