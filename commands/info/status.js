import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embed.js";
import { execCommand } from "../../shell/execCommand.js";
import config from "../../config.json" assert { type: "json" };
import { getPlayerCount } from "../../utils/utils.js";

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
        inline: true,
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
  const screenCmd = `sudo -u ${config.linuxUser} screen -list`;
  const output = await execCommand(screenCmd);

  const isRunning = new RegExp(`\\b\\d+\\.${config.screenSession}\\b`).test(
    output
  );

  if (!isRunning) {
    return {
      status: "Offline",
      playerCount: 0,
      maxPlayers: "Unknown",
    };
  }

  const { playerCount, maxPlayers } = await getPlayerCount();

  const isValidCount =
    typeof playerCount === "number" && typeof maxPlayers === "number";
  if (!isValidCount) {
    return {
      status: "Online",
      playerCount: 0,
      maxPlayers: "Unknown",
    };
  }

  return {
    status: `Online with ${playerCount}/${maxPlayers} players`,
    playerCount,
    maxPlayers,
  };
}
