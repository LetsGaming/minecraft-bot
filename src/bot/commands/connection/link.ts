import { SlashCommandBuilder } from "discord.js";
import { createInfoEmbed } from "../../utils/embeds/embedUtils.js";
import { withErrorHandling } from "../middleware.js";
import { randomBytes } from "crypto";
import { issueLinkCode } from "@mcbot/core/utils/stores/linkUtils.js";

import { t } from "@mcbot/core/utils/i18n.js";
export const data = new SlashCommandBuilder()
  .setName("link")
  .setDescription("Link your Discord account to your Minecraft account");

export const execute = withErrorHandling(
  async (interaction) => {
    const result = await issueLinkCode(interaction.user.id, generateCode());
    const title = t("link.title");

    const description =
      result.status === "pending"
        ? t("link.pending", { code: result.code })
        : result.status === "already-linked"
          ? t("link.alreadyLinked")
          : t("link.instructions", { code: result.code });

    await interaction.editReply({ embeds: [createInfoEmbed(description, { title })] });
  },
  { ephemeral: true },
);

function generateCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}
