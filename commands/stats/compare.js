import { SlashCommandBuilder } from "discord.js";
import {
  loadStats,
  flattenStats,
  filterStats,
  humanizeKey,
  formatPlaytime,
  formatDistance,
} from "../../utils/statUtils.js";
import {
  createEmbed,
  createPaginationButtons,
  handlePagination,
  createErrorEmbed,
  createInfoEmbed,
} from "../../utils/embedUtils.js";
import { findPlayer } from "../../utils/utils.js";

export const data = new SlashCommandBuilder()
  .setName("compare")
  .setDescription("Compare stats of two players")
  .addStringOption((option) =>
    option
      .setName("player1")
      .setDescription("First player name")
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("player2")
      .setDescription("Second player name")
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

  const player1 = interaction.options.getString("player1");
  const player2 = interaction.options.getString("player2");
  const filterStat = interaction.options.getString("stat");

  try {
    const player1Data = await findPlayer(player1);
    const player2Data = await findPlayer(player2);
    // Load stats for both players
    const stats1 = await loadStats(player1Data.uuid);
    const stats2 = await loadStats(player2Data.uuid);

    if (!stats1 || !stats2) {
      const errEmbd = createErrorEmbed(
        `Stats file not found for one or both players: \`${player1}\`, \`${player2}\`.`
      );
      return interaction.editReply({ embeds: [errEmbd] });
    }

    // Flatten and filter stats
    let flattened1 = flattenStats(stats1);
    let flattened2 = flattenStats(stats2);

    if (filterStat) {
      flattened1 = filterStats(flattened1, filterStat);
      flattened2 = filterStats(flattened2, filterStat);
    }

    // Build comparison embeds
    const embeds = buildComparisonEmbeds(flattened1, flattened2, player1, player2);

    if (embeds.length === 0) {
      const infoEmbd = createInfoEmbed(
        `No stats found for \`${player1}\` and \`${player2}\`.`
      );
      return interaction.editReply({ embeds: [infoEmbd] });
    }

    if (embeds.length === 1) {
      await interaction.editReply({ embeds });
    } else {
      const message = await interaction.editReply({
        embeds: [embeds[0]],
        components: [createPaginationButtons(0, embeds.length)],
        fetchReply: true,
      });

      await handlePagination(message, interaction, embeds);
    }
  } catch (error) {
    console.error("Error comparing players:", error);
    return interaction.editReply({
      embeds: [createErrorEmbed("❌ An error occurred while comparing players.")],
    });
  }
}

export function buildComparisonEmbeds(flat1, flat2, name1, name2) {
  const embeds = [];
  let currentEmbed = createEmbed({ title: "PLACEHOLDER" });
  let fieldCount = 0;

  const statMap2 = new Map(flat2.map(stat => [stat.fullKey, stat]));
  const combined = [];

  for (const s1 of flat1) {
    const s2 = statMap2.get(s1.fullKey);
    if (!s2) continue;

    const key = s1.key.toLowerCase();
    const value1 = parseInt(s1.value, 10);
    const value2 = parseInt(s2.value, 10);

    const isTime = key.includes("time");
    const isDistance = key.includes("one_cm");

    let formatted1, formatted2;
    if (isTime) {
      formatted1 = formatPlaytime(value1);
      formatted2 = formatPlaytime(value2);
    } else if (isDistance) {
      formatted1 = formatDistance(value1);
      formatted2 = formatDistance(value2);
    } else {
      formatted1 = value1.toLocaleString();
      formatted2 = value2.toLocaleString();
    }

    const line = `• ${humanizeKey(s1.key)}:\n> ${name1}: ${formatted1}\n> ${name2}: ${formatted2}`;
    combined.push({ category: s1.category, line });
  }

  const grouped = {};
  for (const item of combined) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item.line);
  }

  for (const [category, lines] of Object.entries(grouped)) {
    let index = 0;
    let chunkNumber = 1;

    while (index < lines.length) {
      const chunk = [];
      let chunkLength = 0;

      while (index < lines.length && chunkLength + lines[index].length < 1024) {
        chunk.push(lines[index]);
        chunkLength += lines[index].length;
        index++;
      }

      const name =
        chunkNumber === 1
          ? humanizeKey(category)
          : `${humanizeKey(category)} (${chunkNumber})`;
      const value = chunk.join("\n");

      if (fieldCount >= 2) {
        embeds.push(currentEmbed);
        currentEmbed = createEmbed({ title: "PLACEHOLDER" });
        fieldCount = 0;
      }

      currentEmbed.addFields({
        name,
        value,
        inline: false,
      });

      fieldCount++;
      chunkNumber++;
    }
  }

  if (fieldCount > 0) {
    embeds.push(currentEmbed);
  }

  const totalPages = embeds.length;
  for (let i = 0; i < totalPages; i++) {
    const embed = embeds[i];
    embed.data.title = `Stat Comparison: ${name1} vs ${name2} (Page ${i + 1}/${totalPages})`;
    embed.setFooter({
      text: `Shared stats: ${combined.length} | Page ${i + 1}/${totalPages}`,
    });
  }

  return embeds;
}
