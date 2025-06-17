import { SlashCommandBuilder } from "discord.js";
import fs from "fs";
import path from "path";

const codesPath = "./data/linkCodes.json"; // adjust if needed

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
  if (!fs.existsSync(codesPath)) return {};
  return JSON.parse(fs.readFileSync(codesPath, "utf-8"));
}

function saveCodes(codes) {
  fs.writeFileSync(codesPath, JSON.stringify(codes, null, 2));
}
