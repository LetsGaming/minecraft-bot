import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { sendToServer } from "../../utils/sendToServer.js";

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
    await interaction.editReply("❌ Failed to send message to Minecraft.");
  }
}
