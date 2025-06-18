import { SlashCommandBuilder, MessageFlags } from "discord.js";
import path from "path";
import { fileURLToPath } from "url";
import { loadJson, saveJson } from "../../utils/utils.js";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const codesPath = path.resolve(__dirname, "../../data/linkCodes.json");

export const data = new SlashCommandBuilder()
  .setName("unlink")
  .setDescription("Unlink your Discord account from your Minecraft account");

export async function execute(interaction) {
  const userId = interaction.user.id;

  // Load existing codes
  let codes = await loadJson(codesPath).catch(() => ({}));
  if (!codes) {
    codes = {};
  }

  // Find the code for this user
  const codeEntry = Object.entries(codes).find(
    ([, entry]) => entry.discordId === userId && !entry.confirmed
  );

  if (!codeEntry) {
    return interaction.reply({
      content: "❌ You have no active link to unlink.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const [code] = codeEntry;

  // Remove the code from the store
  delete codes[code];
  await saveJson(codesPath, codes);

  await interaction.reply({
    content: `✅ Your Discord account has been unlinked from Minecraft. Code \`${code}\` is now invalid.`,
    flags: MessageFlags.Ephemeral,
  });
}
