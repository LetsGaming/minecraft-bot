import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embedUtils.js";
import { isServerRunning, getServerList } from "../../utils/server.js";

export const data = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Get the current status of the Minecraft server");

export async function execute(interaction) {
  const sent = Date.now();
  await interaction.deferReply();

  try {
    const running = await isServerRunning();
    const botPing = interaction.client.ws.ping;
    const roundTrip = Date.now() - sent;

    if (!running) {
      const embed = createEmbed({
        title: "Minecraft Server Status",
        description: "Server is currently **Offline**",
        footer: { text: `Requested by ${interaction.user.tag}` },
      });
      embed.addFields(
        { name: "Bot Ping", value: `${botPing}ms`, inline: true },
        { name: "Round Trip", value: `${roundTrip}ms`, inline: true }
      );
      return await interaction.editReply({ embeds: [embed] });
    }

    const { playerCount, maxPlayers } = await getServerList();

    const embed = createEmbed({
      title: "Minecraft Server Status",
      description: `Server is currently **Online** with ${playerCount}/${maxPlayers} players`,
      footer: { text: `Requested by ${interaction.user.tag}` },
    });
    embed.addFields(
      { name: "Players", value: `${playerCount}/${maxPlayers}`, inline: true },
      { name: "Bot Ping", value: `${botPing}ms`, inline: true },
      { name: "Round Trip", value: `${roundTrip}ms`, inline: true }
    );

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error(err);
    await interaction.editReply("❌ An unexpected error occurred.");
  }
}
