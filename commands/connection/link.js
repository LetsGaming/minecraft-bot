import { SlashCommandBuilder } from "discord.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { loadJson, saveJson } from "../../utils/utils.js";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const codesPath = path.resolve(__dirname, "../../data/linkCodes.json");

export const data = new SlashCommandBuilder()
  .setName("link")
  .setDescription("Link your Discord account to your Minecraft account");

export async function execute(interaction) {
  const userId = interaction.user.id;

  const code = generateCode();
  const expires = Date.now() + 5 * 60 * 1000; // 5 minutes

  const codes = loadCodes();
  codes[code] = {
    discordId: userId,
    expires,
    confirmed: false,
  };

  saveCodes(codes);

  await interaction.reply({
    content: `🧩 To link your Minecraft account, join the server and type:\n\`!link ${code}\`\n(This code expires in 5 minutes)`,
    ephemeral: true,
  });
}

function generateCode(length = 6) {
  return [...Array(length)]
    .map(() =>
      Math.floor(Math.random() * 36)
        .toString(36)
        .toUpperCase()
    )
    .join("");
}

function loadCodes() {
  if (!fs.existsSync(codesPath)) {
    saveCodes({});
    return {};
  }
  return loadJson(codesPath);
}

function saveCodes(codes) {
  // Ensure parent directory exists
  const dir = path.dirname(codesPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  saveJson(codesPath, codes);
}
