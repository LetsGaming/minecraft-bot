import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { randomBytes } from "crypto";
import { loadLinkCodes, saveLinkCodes } from "../../utils/linkUtils.js";

export const data = new SlashCommandBuilder()
  .setName("link")
  .setDescription("Link your Discord account to your Minecraft account");

export async function execute(
  interaction: import("discord.js").ChatInputCommandInteraction,
): Promise<void> {
  const userId = interaction.user.id;

  const code = generateCode();
  const expires = Date.now() + 5 * 60 * 1000;

  const codes = await loadLinkCodes();
  codes[code] = {
    discordId: userId,
    expires,
    confirmed: false,
  };

  await saveLinkCodes(codes);

  await interaction.reply({
    content: `🧩 To link your Minecraft account, join the server and type:\n\`!link ${code}\`\n(This code expires in 5 minutes)`,
    flags: MessageFlags.Ephemeral,
  });
}

// Uses crypto.randomBytes for a cryptographically secure 8-char hex code
// (4 billion combinations). Replaces the old Math.random-based generator
// which was brute-forceable within the 5-minute expiry window.
function generateCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}
