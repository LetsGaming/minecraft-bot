import { SlashCommandBuilder } from "discord.js";
import { createEmbed, createErrorEmbed } from "../../utils/embedUtils.js";
import { getSeed } from "../../utils/utils.js";

export const data = new SlashCommandBuilder()
  .setName("chunkbase")
  .setDescription("Get a link to the Chunkbase map for the server's world seed");

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

  const embed = createEmbed({
    title: "Chunkbase Map",
    description: `You can view the Chunkbase map for the server's world seed [here](https://www.chunkbase.com/apps/seed-map#seed=${seed}).`,
    footer: { text: `Requested by ${interaction.user.tag}` },
  });

  await interaction.editReply({ embeds: [embed] });
}

