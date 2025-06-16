import { SlashCommandBuilder } from "discord.js";
import fs from "fs";
import path from "path";
import config from "../../config.json" assert { type: "json" };
import {
  createEmbed,
  createPaginationButtons,
  handlePagination,
} from "../../utils/embed.js";

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
      return interaction.editReply({
        content: "No players found in whitelist.",
      });
    }

    const usernames = players
      .map((p) => p.name)
      .sort((a, b) => a.localeCompare(b));

    const chunkSize = 20; // number of names per page
    const totalPages = Math.ceil(usernames.length / chunkSize);
    const embeds = [];

    for (let i = 0; i < totalPages; i++) {
      const page = usernames.slice(i * chunkSize, (i + 1) * chunkSize);
      const embed = createEmbed({
        title: `📃 Whitelisted Minecraft Players`,
      })
        .addFields({
          name: `Page ${i + 1}`,
          value: page.join(", "),
        })
        .setFooter({ text: `Total: ${usernames.length}` });

      embeds.push(embed);
    }

    const message = await interaction.editReply({
      embeds: [embeds[0]],
      components: totalPages > 1 ? [createPaginationButtons(0, totalPages)] : [],
      fetchReply: true,
    });

    if (totalPages > 1) {
      await handlePagination(message, interaction, embeds);
    }
  } catch (err) {
    console.error(err);
    await interaction.editReply("❌ Failed to read the whitelist.");
  }
}
