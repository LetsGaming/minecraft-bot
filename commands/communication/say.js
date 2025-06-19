import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { sendToServer } from "../../utils/sendToServer.js";
import { createErrorEmbed } from "../../utils/embed.js";

export const data = new SlashCommandBuilder()
  .setName("say")
  .setDescription("Send a message to the Minecraft server chat")
  .addStringOption((option) =>
    option
      .setName("message")
      .setDescription("Message to send")
      .setRequired(true)
  );

export async function execute(interaction) {
  const message = interaction.options.getString("message");
  const discordUsername = interaction.user.username;

  const mcMessage = `${discordUsername}: ${message}`;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    await sendToServer(`/say ${mcMessage}`);
    await interaction.editReply(`✅ Sent to Minecraft: "${mcMessage}"`);
  } catch (err) {
    console.error(err);
    const errorEmbed = createErrorEmbed(
      `Failed to send message to Minecraft: ${err.message}`,
      {
        footer: { text: "Communication Error" },
        timestamp: new Date(),
      }
    );
    await interaction.editReply({ embeds: [errorEmbed] });
  }
}
