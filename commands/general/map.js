import { SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("map")
  .setDescription("Shows the link to the live Minecraft map (Dynmap)");

export async function execute(interaction) {
  const mapUrl = "http://vanilla-craft.duckdns.org/map/";
  await interaction.reply(mapUrl);
}
