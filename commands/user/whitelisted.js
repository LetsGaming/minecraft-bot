import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import fs from "fs";
import path from "path";
import config from "../../config.json" assert { type: "json" };

export const data = new SlashCommandBuilder()
  .setName("whitelisted")
  .setDescription("List all players who have been whitelisted on the Minecraft server");

export async function execute(interaction) {
  await interaction.deferReply();

  const cachePath = path.resolve(config.serverDir, "whitelist.json");

  try {
    const rawData = fs.readFileSync(cachePath, "utf-8");
    const players = JSON.parse(rawData);

    if (!Array.isArray(players) || players.length === 0) {
      return interaction.editReply("No players found in whitelist.");
    }

    const usernames = players.map(p => p.name).sort((a, b) => a.localeCompare(b));
    const chunks = [];

    // Split into x-name chunks to avoid hitting embed field limits
    const maxFields = 10; // Max fields per embed
    for (let i = 0; i < usernames.length; i += maxFields) {
      chunks.push(usernames.slice(i, i + maxFields));
    }

    const embed = new EmbedBuilder()
      .setTitle("Whitelisted Minecraft Players")
      .setColor(0x00bfff)
      .setFooter({ text: `Total: ${usernames.length}` })
      .setTimestamp();

    chunks.forEach((chunk, index) => {
      embed.addFields({
        name: `Page ${index + 1}`,
        value: chunk.join(", "),
      });
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error(err);
    await interaction.editReply("❌ Failed to read the whitelist.");
  }
}
