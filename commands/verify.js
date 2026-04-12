import { SlashCommandBuilder } from "discord.js";
import { sendToServer } from "../utils/server.js";
import { createErrorEmbed, createSuccessEmbed } from "../utils/embedUtils.js";

export const data = new SlashCommandBuilder()
  .setName("verify")
  .setDescription("Verify a Minecraft username and whitelist it")
  .addStringOption((option) =>
    option
      .setName("username")
      .setDescription("Minecraft username to verify")
      .setRequired(true)
  );

export async function execute(interaction) {
  const username = interaction.options.getString("username");
  await interaction.deferReply();

  try {
    const res = await fetch(
      `https://api.mojang.com/users/profiles/minecraft/${username}`
    );
    if (!res.ok) {
      return interaction.editReply({
        embeds: [createErrorEmbed(`Username **${username}** not found.`)],
      });
    }

    await sendToServer(`/whitelist add ${username}`);

    await interaction.editReply({
      embeds: [createSuccessEmbed(`**${username}** has been whitelisted.`)],
    });
  } catch (err) {
    console.error(err);
    await interaction.editReply({
      embeds: [createErrorEmbed("An unexpected error occurred.")],
    });
  }
}
