import { SlashCommandBuilder } from "discord.js";
import fs from "fs";
import path from "path";
import {
  loadAllStats,
  flattenStats,
  filterStats,
  findPlayTimeStat,
  formatPlaytime,
} from "../../utils/statUtils.js";
import { createEmbed } from "../../utils/embed.js";
import config from "../../config.json" assert { type: "json" };
import { deleteStats } from "../../utils/utils.js";

export const data = new SlashCommandBuilder()
  .setName("top")
  .setDescription("Show the top players by a specific stat.")
  .addStringOption((option) =>
    option
      .setName("stat")
      .setDescription("The stat to rank players by.")
      .setRequired(true)
      .addChoices(
        { name: "Playtime", value: "playtime" },
        { name: "Mob Kills", value: "mob_kills" },
        { name: "Deaths", value: "deaths" }
      )
  );

export async function execute(interaction) {
  await interaction.deferReply();

  const statKey = interaction.options.getString("stat");

  try {
    const allStats = await loadAllStats(); // returns { uuid: statsJson }
    if (!allStats || Object.keys(allStats).length === 0) {
      return interaction.editReply("❌ No player stats found.");
    }

    // Load whitelist once to map UUID to player name
    const whitelistPath = path.resolve(config.serverDir, "whitelist.json");
    let whitelist = [];
    if (fs.existsSync(whitelistPath)) {
      whitelist = JSON.parse(fs.readFileSync(whitelistPath, "utf-8"));
    }

    // Extract player info and relevant stat value
    const leaderboard = [];

    for (const [uuid, stats] of Object.entries(allStats)) {
      const flat = flattenStats(stats.stats);
      console.log(`Processing stats for UUID: ${uuid}`);
      console.log(`Flattened stats:`, flat);
      let statValue = getStatValue(flat, statKey);

      // For deaths, include zero values; for others, skip zero values
      if (statKey !== "deaths" && statValue === 0) continue;
      if (statKey === "playtime") {
        // Convert playtime from seconds to a more readable format
        statValue = formatPlaytime(statValue);
      }

      // Get player name from whitelist by UUID
      const playerObj = whitelist.find((p) => p.uuid === uuid);
      const playerName = playerObj ? playerObj.name : "Unknown";

      if (playerName === "Unknown") {
        deleteStats(uuid); // Clean up stats for unknown players
        continue; // Skip unknown players
      }

      leaderboard.push({
        name: playerName,
        value: statValue,
      });
    }
    if (leaderboard.length === 0) {
      return interaction.editReply(`❌ No stats found for "${statKey}".`);
    }

    // Sort leaderboard descending except for deaths which is ascending (optional)
    if (statKey.toLowerCase() === "deaths") {
      leaderboard.sort((a, b) => a.value - b.value);
    } else {
      leaderboard.sort((a, b) => b.value - a.value);
    }

    // Limit to top 10 players
    const topPlayers = leaderboard.slice(0, 10);

    // Build embed description with rankings
    const lines = topPlayers.map(
      (p, i) => `**${i + 1}.** ${p.name} — \`${p.value.toLocaleString()}\``
    );

    const embed = createEmbed({
      title: `Top Players by ${
        statKey.charAt(0).toUpperCase() + statKey.slice(1)
      }`,
      description: lines.join("\n"),
      color: 0x00ff00,
      footer: { text: `Showing top ${topPlayers.length}` },
      timestamp: new Date(),
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error(err);
    await interaction.editReply("❌ An unexpected error occurred.");
  }
}

function getStatValue(flatStats, statKey) {
  // Map user input to category/key or aggregation function
  switch (statKey.toLowerCase()) {
    case "playtime":
      // play_time under minecraft:custom category
      const playtimeStat = findPlayTimeStat(flatStats);
      if (playtimeStat) {
        // Return playtime in seconds
        return playtimeStat;
      } else {
        // If no playtime stat found, return 0
        return 0;
      }

    case "mob_kills":
      // sum all keys under minecraft:killed category
      const mobKills = filterStats(flatStats, "mob_kills");
      if (mobKills.length > 0) {
        // If multiple mob kill stats, sum them
        return mobKills.reduce((sum, s) => sum + s.value, 0);
      } else {
        // If no specific mob kill stat, return 0
        return 0;
      }

    case "deaths":
      // Try to find the single stat for deaths under minecraft:custom or minecraft:stats
      const deathStat = filterStats(flatStats, "deaths");
      if (deathStat.length > 0) {
        // If multiple death stats, sum them
        return deathStat.reduce((sum, s) => sum + s.value, 0);
      } else {
        // If no specific death stat, return 0
        return 0;
      }

    default:
      // fallback: try exact key match in any category
      const stat = flatStats.find((s) => s.key === statKey);
      return stat ? stat.value : 0;
  }
}
