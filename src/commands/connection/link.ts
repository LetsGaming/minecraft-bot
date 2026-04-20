import { SlashCommandBuilder, MessageFlags, type ChatInputCommandInteraction} from "discord.js";
import { randomBytes } from "crypto";
import { loadLinkCodes, saveLinkCodes } from "../../utils/linkUtils.js";

export const data = new SlashCommandBuilder()
  .setName("link")
  .setDescription("Link your Discord account to your Minecraft account");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const userId = interaction.user.id;

  const codes = await loadLinkCodes();

  // Check if user already has a pending code
  for (const code in codes) {
    const current = codes[code];
    if (!current) continue;

    if (current.discordId === userId) {
      // Check if the existing code is still valid
      if (current.expires > Date.now()) {
        await interaction.reply({
          content: `⚠️ You already have a pending link code: \`${code}\`. Please use that code or wait for it to expire before generating a new one.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      } else if (current.confirmed) {
        await interaction.reply({
          content: `⚠️ You have already linked your account. If you want to link a different Minecraft account, please unlink first.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      } else {
        // Remove expired code
        delete codes[code];
      }
    }
  }

  const code = generateCode();
  const expires = Date.now() + 5 * 60 * 1000;

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
