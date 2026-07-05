import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  loadLinkedAccounts,
  saveLinkedAccounts,
} from "../../../common/utils/linkUtils.js";
import { syncLinkedRole } from "../../utils/linkedRole.js";

export const data = new SlashCommandBuilder()
  .setName("unlink")
  .setDescription("Unlink your Discord account from your Minecraft account");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const userId = interaction.user.id;

  const linkedAccounts = await loadLinkedAccounts().catch(
    (): Record<string, string> => ({}),
  );
  if (!(userId in linkedAccounts)) {
    await interaction.reply({
      content:
        "❌ Your Discord account is not linked to any Minecraft account.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  delete linkedAccounts[userId];
  await saveLinkedAccounts(linkedAccounts);
  // Remove the auto-assigned linked role again; never fails the unlink.
  await syncLinkedRole(interaction.client, userId, "remove");
  await interaction.reply({
    content:
      "✅ Your Discord account has been successfully unlinked from your Minecraft account.",
    flags: MessageFlags.Ephemeral,
  });
}
