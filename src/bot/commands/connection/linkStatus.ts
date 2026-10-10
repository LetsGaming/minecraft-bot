import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { getLinkedAccount } from "@mcbot/core/utils/stores/linkUtils.js";

import { t } from "@mcbot/core/utils/i18n.js";
export const data = new SlashCommandBuilder()
  .setName("linkstatus")
  .setDescription("Check your linked Minecraft account status");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const userId = interaction.user.id;

  const linkedAccount = await getLinkedAccount(userId);
  if (!linkedAccount) {
    await interaction.reply({
      content: t("link.notLinked", {}, interaction.guildId ?? undefined),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: t("link.status", { account: linkedAccount }, interaction.guildId ?? undefined),
    flags: MessageFlags.Ephemeral,
  });
}
