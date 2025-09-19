import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embedUtils.js";
import { isScreenRunning } from "../../utils/utils.js";
import { getPlayerCount } from "../../utils/playerUtils.js";

export const data = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Get the current status of the Minecraft server");

export async function execute(interaction) {
  const sent = Date.now();
  await interaction.deferReply();

  try {
    const status = await getServerStatus();

    const botPing = interaction.client.ws.ping; // WebSocket ping
    const roundTrip = Date.now() - sent; // Time from command to response

    const embed = createEmbed({
      title: "Minecraft Server Status",
      description: `Server is currently **${status.status}**`,
      footer: { text: `Requested by ${interaction.user.tag}` },
    });
    embed.addFields(
      {
        name: "Player Count",
        value: `${status.playerCount}/${status.maxPlayers}`,
        inline: false,
      },
      { name: "Bot Ping", value: `${botPing}ms`, inline: true },
      { name: "Round Trip Time", value: `${roundTrip}ms`, inline: true }
    );
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error(err);
    await interaction.editReply(`❌ An unexpected error occurred.`);
  }
}

async function getServerStatus() {
  const isRunning = await isScreenRunning();

  if (!isRunning) {
    return {
      status: "Offline",
      playerCount: 0,
      maxPlayers: "Unknown",
    };
  }

  const { playerCount, maxPlayers } = await getPlayerCount();
  if (playerCount === null || maxPlayers === null) {
    return {
      status: "Online (Player count unknown)",
      playerCount: "Unknown",
      maxPlayers: "Unknown",
    };
  }

  return {
    status: `Online with ${playerCount}/${maxPlayers} players`,
    playerCount,
    maxPlayers,
  };
}
