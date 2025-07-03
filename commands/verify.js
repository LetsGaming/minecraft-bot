import { SlashCommandBuilder } from "discord.js";
import fetch from "node-fetch";
import { sendToServer } from "../utils/utils.js";
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
    if (res.status !== 200) {
      const errEmbd = createErrorEmbed(
        `Username **${username}** not found. Please check the spelling and try again.`,
        {
          footer: { text: "Mojang API Error" },
          timestamp: new Date(),
        }
      );
      return interaction.editReply({ embeds: [errEmbd] });
    }

    const success = await whitelistUser(username);
    if (!success) {
      const errEmbd = createErrorEmbed(
        `Failed to whitelist **${username}**.`,
        {
          footer: { text: "Whitelist Error" },
          timestamp: new Date(),
        }
      );
      return interaction.editReply({ embeds: [errEmbd] });
    }

    await interaction.editReply({ embeds: [createSuccessEmbed(`✅ **${username}** has been whitelisted.`, { footer: { text: "Whitelist Success" }, timestamp: new Date() })] });
  } catch (err) {
    console.error(err);
    await interaction.editReply(`❌ An unexpected error occurred.`);
  }
}

/**
 * Adds a user to the Minecraft whitelist.
 *
 * @param {string} username
 * @returns {Promise<boolean>}
 */
export async function whitelistUser(username) {
  try {
    await sendToServer(`/whitelist add ${username}`);
    return true;
  } catch (err) {
    console.error("Whitelist error:", err.stderr || err.error);
    return false;
  }
}
