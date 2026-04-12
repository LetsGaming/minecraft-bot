import { SlashCommandBuilder } from "discord.js";
import { createEmbed, createErrorEmbed } from "../../utils/embedUtils.js";
import { getServerSeed } from "../../utils/server.js";
import { getLinkedAccount } from "../../utils/linkUtils.js";
import { getPlayerCoords } from "../../utils/playerUtils.js";

export const data = new SlashCommandBuilder()
  .setName("chunkbase")
  .setDescription("Get a link to the Chunkbase map for the server's world seed")
  .addStringOption((option) =>
    option
      .setName("dimension")
      .setDescription("The dimension to view.")
      .setRequired(false)
      .addChoices(
        { name: "Overworld", value: "overworld" },
        { name: "Nether", value: "nether" },
        { name: "End", value: "end" }
      )
  );

export async function execute(interaction) {
  await interaction.deferReply();

  const seed = await getServerSeed();
  if (!seed) {
    await interaction.editReply({ embeds: [createErrorEmbed("Could not retrieve the world seed.")] });
    return;
  }

  const dimension = interaction.options.getString("dimension") || "overworld";
  const userId = interaction.user.id;
  const linkedUsername = await getLinkedAccount(userId);

  let coordsParam = "";
  if (linkedUsername) {
    try {
      const playerCoords = await getPlayerCoords(linkedUsername);
      if (playerCoords) {
        coordsParam = `&x=${Math.floor(playerCoords.x)}&z=${Math.floor(playerCoords.z)}`;
      }
    } catch (err) {
      console.warn(`Failed to get player coords for ${linkedUsername}:`, err.message);
    }
  }

  const baseUrl = `https://www.chunkbase.com/apps/seed-map#seed=${seed}&dimension=${dimension}${coordsParam}`;

  const embed = createEmbed({
    title: "Chunkbase Map",
    description: `View the seed map on Chunkbase: [Open Map](${baseUrl})`,
    footer: { text: `Requested by ${interaction.user.tag}` },
  });

  await interaction.editReply({ embeds: [embed] });
}
