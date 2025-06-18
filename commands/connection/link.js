import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { loadLinkCodes, saveLinkCodes } from "../../utils/linkUtils.js";

export const data = new SlashCommandBuilder()
  .setName("link")
  .setDescription("Link your Discord account to your Minecraft account");

export async function execute(interaction) {
  const userId = interaction.user.id;

  const code = generateCode();
  const expires = Date.now() + 5 * 60 * 1000; // 5 minutes

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

function generateCode(length = 6) {
  return [...Array(length)]
    .map(() =>
      Math.floor(Math.random() * 36)
        .toString(36)
        .toUpperCase()
    )
    .join("");
}
