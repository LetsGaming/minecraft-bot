import { SlashCommandBuilder, MessageFlags } from "discord.js";
import {
  loadLinkedAccounts,
  saveLinkedAccounts,
} from "../../utils/linkUtils.js";

export const data = new SlashCommandBuilder()
  .setName("unlink")
  .setDescription("Unlink your Discord account from your Minecraft account");

export async function execute(interaction) {
  const userId = interaction.user.id;

  const linkedAccounts = await loadLinkedAccounts().catch(() => ({}));
  if (!(userId in linkedAccounts)) {
    return interaction.reply({
      content:
        "❌ Your Discord account is not linked to any Minecraft account.",
      flags: MessageFlags.Ephemeral,
    });
  }

  delete linkedAccounts[userId];
  await saveLinkedAccounts(linkedAccounts);
  return interaction.reply({
    content:
      "✅ Your Discord account has been successfully unlinked from your Minecraft account.",
    flags: MessageFlags.Ephemeral,
  });
}
