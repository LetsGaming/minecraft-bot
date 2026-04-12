import { SlashCommandBuilder } from "discord.js";
import { createEmbed, createErrorEmbed } from "../../utils/embedUtils.js";
import { getServerSeed } from "../../utils/server.js";

export const data = new SlashCommandBuilder()
  .setName("seed")
  .setDescription("Get the server's world seed");

export async function execute(interaction) {
  await interaction.deferReply();
  const seed = await getServerSeed();

  if (!seed) {
    await interaction.editReply({ embeds: [createErrorEmbed("Could not retrieve the world seed.")] });
    return;
  }

  const embed = createEmbed({
    title: "World Seed",
    description: `The server's world seed is:\n\`${seed}\``,
    footer: { text: `Requested by ${interaction.user.tag}` },
  });

  await interaction.editReply({ embeds: [embed] });
}
