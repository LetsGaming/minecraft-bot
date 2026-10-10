import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { unlinkAccount } from "@mcbot/core/utils/stores/linkUtils.js";
import { syncLinkedRole } from "../../utils/guild/linkedRole.js";

import { t } from "@mcbot/core/utils/i18n.js";
export const data = new SlashCommandBuilder()
  .setName("unlink")
  .setDescription("Unlink your Discord account from your Minecraft account");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const userId = interaction.user.id;

  // Atomic check-and-delete: no load/mutate/save round-trip to race.
  const removed = await unlinkAccount(userId).catch(() => false);
  if (!removed) {
    await interaction.reply({
      content: t("link.notLinked", {}, interaction.guildId ?? undefined),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Remove the auto-assigned linked role again; never fails the unlink.
  await syncLinkedRole(interaction.client, userId, "remove");
  await interaction.reply({
    content: t("link.unlinked", {}, interaction.guildId ?? undefined),
    flags: MessageFlags.Ephemeral,
  });
}
