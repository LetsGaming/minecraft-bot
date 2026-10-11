import { SlashCommandBuilder } from "discord.js";
import { createInfoEmbed } from "../../utils/embeds/embedUtils.js";
import { withErrorHandling } from "../middleware.js";
import { getLinkedAccount } from "@mcbot/core/utils/stores/linkUtils.js";

import { t } from "@mcbot/core/utils/i18n.js";
export const data = new SlashCommandBuilder()
  .setName("linkstatus")
  .setDescription("Check your linked Minecraft account status");

export const execute = withErrorHandling(
  async (interaction) => {
    const linkedAccount = await getLinkedAccount(interaction.user.id);
    const description = linkedAccount
      ? t("link.status", { account: linkedAccount })
      : t("link.notLinked");
    await interaction.editReply({
      embeds: [createInfoEmbed(description, { title: t("link.statusTitle") })],
    });
  },
  { ephemeral: true },
);
