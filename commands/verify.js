import { SlashCommandBuilder } from "discord.js";
import fetch from "node-fetch";
import { sendToServer } from "../utils/server.js";

export const data = new SlashCommandBuilder()
  .setName("verify")
  .setDescription("Verify a Minecraft username and whitelist it")
  .addStringOption(option =>
    option.setName("username")
      .setDescription("Minecraft username to verify")
      .setRequired(true)
  );

export async function execute(interaction) {
  const username = interaction.options.getString("username");
  await interaction.deferReply();

  try {
    const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);
    if (res.status !== 200) {
      return interaction.editReply(`❌ Username **${username}** not found.`);
    }

    const success = await whitelistUser(username);
    if (!success) {
      return interaction.editReply(`❌ Failed to whitelist **${username}**.`);
    }

    await interaction.editReply(`✅ **${username}** has been whitelisted.`);
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
