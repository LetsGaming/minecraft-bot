import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { getServerInstance } from "../../utils/server.js";
import { getGuildServer } from "../../config.js";
import { withErrorHandling } from "../middleware.js";

export const data = new SlashCommandBuilder()
  .setName("say")
  .setDescription("Send a message to the Minecraft server chat")
  .addStringOption(o => o.setName("message").setDescription("Message to send").setRequired(true))
  .addStringOption(o => o.setName("server").setDescription("Server instance").setAutocomplete(true));

export const execute = withErrorHandling(async (interaction) => {
  const message = interaction.options.getString("message");
  const serverId = interaction.options.getString("server");
  const server = serverId ? getServerInstance(serverId) : getGuildServer(interaction.guild?.id);
  if (!server) throw new Error("Server not found.");

  const mcMessage = `[${interaction.user.displayName}] ${message}`;
  await server.sendCommand(`/say ${mcMessage}`);
  await interaction.editReply(`✅ Sent to **${server.id}**: "${mcMessage}"`);
}, { ephemeral: true });
