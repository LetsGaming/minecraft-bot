import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction} from "discord.js";
import { randomBytes } from "crypto";
import { issueLinkCode } from "@mcbot/core/utils/linkUtils.js";

export const data = new SlashCommandBuilder()
  .setName("link")
  .setDescription("Link your Discord account to your Minecraft account");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const userId = interaction.user.id;

  // issueLinkCode is atomic: prune-expired + pending/linked checks + insert
  // happen in one transaction, so two concurrent /link invocations can't
  // race each other (or the in-game confirmation) anymore.
  const result = await issueLinkCode(userId, generateCode());

  if (result.status === "pending") {
    await interaction.reply({
      content: `⚠️ You already have a pending link code: \`${result.code}\`. Please use that code or wait for it to expire before generating a new one.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (result.status === "already-linked") {
    await interaction.reply({
      content: `⚠️ You have already linked your account. If you want to link a different Minecraft account, please unlink first.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: `🧩 To link your Minecraft account, join the server and type:\n\`!link ${result.code}\`\n(This code expires in 5 minutes)`,
    flags: MessageFlags.Ephemeral,
  });
}

// Uses crypto.randomBytes for a cryptographically secure 8-char hex code
// (4 billion combinations). Replaces the old Math.random-based generator
// which was brute-forceable within the 5-minute expiry window.
function generateCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}
