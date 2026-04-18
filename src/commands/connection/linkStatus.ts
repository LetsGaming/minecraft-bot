import {
  SlashCommandBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from "discord.js";
import { getLinkedAccount } from "../../utils/linkUtils.js";

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
      content:
        "❌ Your Discord account is not linked to any Minecraft account.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: `✅ Your Discord account is linked to Minecraft account: \`${linkedAccount}\``,
    flags: MessageFlags.Ephemeral,
  });
}
