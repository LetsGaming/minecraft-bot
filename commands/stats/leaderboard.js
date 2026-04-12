import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embedUtils.js";
import { loadAllStats, flattenStats, findPlayTimeStat, formatPlaytime, humanizeKey } from "../../utils/statUtils.js";
import { loadWhitelist } from "../../utils/utils.js";
import { withErrorHandling } from "../middleware.js";

export const data = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("Show top players by a stat")
  .addStringOption(o => o.setName("stat").setDescription("Stat to rank by (default: playtime)")
    .addChoices(
      { name: "Playtime", value: "playtime" },
      { name: "Mobs Killed", value: "killed" },
      { name: "Deaths", value: "deaths" },
      { name: "Blocks Mined", value: "mined" },
      { name: "Distance Walked", value: "walked" },
    ));

export const execute = withErrorHandling(async (interaction) => {
  const stat = interaction.options.getString("stat") || "playtime";
  const allStats = await loadAllStats();
  const whitelist = await loadWhitelist() || [];

  const uuidToName = {};
  for (const p of whitelist) uuidToName[p.uuid] = p.name;

  const entries = [];

  for (const [uuid, statsFile] of Object.entries(allStats)) {
    const name = uuidToName[uuid] || uuid.slice(0, 8);
    const flat = flattenStats(statsFile);

    let value = 0;
    let formatted = "";

    switch (stat) {
      case "playtime": {
        value = findPlayTimeStat(flat);
        formatted = formatPlaytime(value);
        break;
      }
      case "killed": {
        const kills = flat.filter(s => s.category === "minecraft:killed");
        value = kills.reduce((sum, s) => sum + s.value, 0);
        formatted = value.toLocaleString();
        break;
      }
      case "deaths": {
        const d = flat.find(s => s.key === "minecraft:deaths");
        value = d?.value || 0;
        formatted = value.toLocaleString();
        break;
      }
      case "mined": {
        const mined = flat.filter(s => s.category === "minecraft:mined");
        value = mined.reduce((sum, s) => sum + s.value, 0);
        formatted = value.toLocaleString();
        break;
      }
      case "walked": {
        const walked = flat.find(s => s.key === "minecraft:walk_one_cm");
        value = walked?.value || 0;
        formatted = `${(value / 100000).toFixed(1)} km`;
        break;
      }
    }

    if (value > 0) entries.push({ name, value, formatted });
  }

  entries.sort((a, b) => b.value - a.value);
  const top = entries.slice(0, 10);

  const medals = ["🥇", "🥈", "🥉"];
  const lines = top.map((e, i) => {
    const prefix = medals[i] || `**${i + 1}.**`;
    return `${prefix} **${e.name}** — ${e.formatted}`;
  });

  const statLabel = { playtime: "Playtime", killed: "Mobs Killed", deaths: "Deaths", mined: "Blocks Mined", walked: "Distance Walked" }[stat];

  const embed = createEmbed({
    title: `🏆 Leaderboard — ${statLabel}`,
    description: lines.join("\n") || "No data available.",
    footer: { text: `${entries.length} players tracked` },
  });

  await interaction.editReply({ embeds: [embed] });
});
