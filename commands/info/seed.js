import { SlashCommandBuilder } from "discord.js";
import { createEmbed, createErrorEmbed } from "../../utils/embedUtils.js";
import { sendToServer, getLatestLogs } from "../../utils/utils.js";

export const data = new SlashCommandBuilder()
  .setName("seed")
  .setDescription("Get information about the server's world seed");

export async function execute(interaction) {
  await interaction.deferReply();
  const seed = await getSeed();

  if (!seed) {
    const errorEmbed = createErrorEmbed(
      "Could not retrieve the world seed."
    );
    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  const embed = createEmbed("World Seed", `The world seed is: \`${seed}\``);

  await interaction.editReply({ embeds: [embed] });
}

async function getSeed() {
  await sendToServer("/seed");
  // Wait a moment to ensure the server has processed the command
  await new Promise((resolve) => setTimeout(resolve, 100));
  const output = await getLatestLogs(10);
  const lines = output.split("\n");
  for (const line of lines.reverse()) {
    const match = line.match(/Seed: \[(-?\d+)\]/);

    if (match) {
      return match[1];
    }
  }
  return null;
}
