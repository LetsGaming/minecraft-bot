import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import fs from "fs";
import path from "path";
import config from "../../config.json" assert { type: "json" };

export const data = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("Show Minecraft stats for a player")
  .addStringOption((option) =>
    option
      .setName("player")
      .setDescription("Minecraft player name")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("stat")
      .setDescription("Optional stat category or specific stat ID")
      .setRequired(false)
  );

export async function execute(interaction) {
  await interaction.deferReply();

  const playerName = interaction.options.getString("player");
  const filterStat = interaction.options.getString("stat")?.toLowerCase();

  try {
    const whitelistPath = path.resolve(config.serverDir, "whitelist.json");
    const whitelist = JSON.parse(fs.readFileSync(whitelistPath, "utf-8"));
    const player = whitelist.find(
      (p) => p.name.toLowerCase() === playerName.toLowerCase()
    );

    if (!player) {
      return interaction.editReply(
        `❌ Player \`${playerName}\` not found in whitelist.`
      );
    }

    const uuid = player.uuid;
    const statsPath = path.resolve(
      config.serverDir,
      "world",
      "stats",
      `${uuid}.json`
    );

    if (!fs.existsSync(statsPath)) {
      return interaction.editReply(
        `❌ Stats file not found for \`${playerName}\`.`
      );
    }

    const statsFile = JSON.parse(fs.readFileSync(statsPath, "utf-8"));
    const allStats = statsFile.stats;

    // Flatten into [category.key, value] pairs
    const flattened = [];
    for (const category in allStats) {
      const group = allStats[category];
      for (const key in group) {
        flattened.push({
          fullKey: `${category}.${key}`,
          category,
          key,
          value: group[key],
        });
      }
    }

    const filteredStats = filterStat
      ? flattened.filter(
          (stat) =>
            stat.fullKey.toLowerCase().includes(filterStat) ||
            stat.category.toLowerCase().includes(filterStat) ||
            stat.key.toLowerCase().includes(filterStat)
        )
      : flattened;

    if (filteredStats.length === 0) {
      return interaction.editReply(
        `❌ No stats found matching \`${filterStat}\`.`
      );
    }

    const embed = new EmbedBuilder()
      .setTitle(`Stats for ${playerName}`)
      .setColor(0x00bfff)
      .setTimestamp();

    filteredStats.slice(0, 25).forEach((stat) => {
      embed.addFields({
        name: stat.key.replace("minecraft:", ""),
        value: stat.value.toLocaleString(),
        inline: true,
      });
    });

    if (filteredStats.length > 25) {
      embed.setFooter({
        text: `Showing first 25 of ${filteredStats.length} results.`,
      });
    }

    return interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error(err);
    return interaction.editReply("❌ Failed to retrieve stats.");
  }
}
