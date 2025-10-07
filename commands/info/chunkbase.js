import { SlashCommandBuilder } from "discord.js";
import { createEmbed, createErrorEmbed } from "../../utils/embedUtils.js";
import { getSeed } from "../../utils/utils.js";
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

  const seed = await getSeed();
  if (!seed) {
    const errorEmbed = createErrorEmbed("Could not retrieve the world seed.");
    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  const dimension = interaction.options.getString("dimension") || "overworld";
  const userId = interaction.user.id;
  const linkedUsername = await getLinkedAccount(userId);

  let coordsParam = "";
  if (linkedUsername) {
    try {
      const playerCoords = await getPlayerCoords(linkedUsername);
      coordsParam = `&x=${Math.floor(playerCoords.x)}&z=${Math.floor(playerCoords.z)}`;
    } catch (err) {
      console.warn(`Failed to get player coords for ${linkedUsername}:`, err.message);
    }
  }

  const baseUrl = `https://www.chunkbase.com/apps/seed-map#seed=${seed}&dimension=${dimension}${coordsParam}`;

  const embed = createEmbed({
    title: "Chunkbase Map",
    description: `You can view the Chunkbase map for the server's world seed [here](${baseUrl}).`,
    footer: { text: `Requested by ${interaction.user.tag}` },
  });

  await interaction.editReply({ embeds: [embed] });
}

