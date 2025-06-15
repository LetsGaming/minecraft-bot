import fs from "fs";
import path from "path";
import config from "../config.json" assert { type: "json" };
import { createEmbed } from "./embed.js";

const ITEMS_PER_PAGE = 25;

/**
 * Creates paginated embeds grouped by category.
 * @param {string} title
 * @param {Array<{ category: string, key: string, value: number }>} stats
 * @returns {{ embeds: EmbedBuilder[], buttons: ActionRowBuilder }}
 */
export function createStatsEmbeds(title, stats) {
  const grouped = {};

  for (const stat of stats) {
    const categoryName = stat.category.replace("minecraft:", "").toUpperCase();
    if (!grouped[categoryName]) grouped[categoryName] = [];
    grouped[categoryName].push(stat);
  }

  const embeds = [];
  const sortedCategories = Object.keys(grouped).sort();

  for (const category of sortedCategories) {
    const statList = grouped[category];
    const totalPages = Math.ceil(statList.length / ITEMS_PER_PAGE);

    for (let page = 0; page < totalPages; page++) {
      const embed = createEmbed({
        title: `${title} — ${category} (Page ${page + 1}/${totalPages})`,
      });

      const pageItems = statList.slice(
        page * ITEMS_PER_PAGE,
        (page + 1) * ITEMS_PER_PAGE
      );

      for (const item of pageItems) {
        embed.addFields({
          name: item.key.replace("minecraft:", ""),
          value: `\`${item.value.toLocaleString()}\``,
          inline: true,
        });
      }

      embeds.push(embed);
    }
  }

  return embeds;
}

/**
 * Find a player object from whitelist by playerName (case insensitive)
 * @param {string} playerName
 * @returns {object|null} player object or null if not found
 */
export function findPlayer(playerName) {
  const whitelistPath = path.resolve(config.serverDir, "whitelist.json");
  if (!fs.existsSync(whitelistPath)) return null;

  const whitelist = JSON.parse(fs.readFileSync(whitelistPath, "utf-8"));
  const player = whitelist.find(
    (p) => p.name.toLowerCase() === playerName.toLowerCase()
  );
  return player ?? null;
}

/**
 * Load and parse stats JSON for given UUID
 * @param {string} uuid
 * @returns {object|null} parsed stats JSON or null if not found
 */
export function loadStats(uuid) {
  const statsPath = path.resolve(
    config.serverDir,
    "world",
    "stats",
    `${uuid}.json`
  );
  if (!fs.existsSync(statsPath)) return null;

  const statsFile = JSON.parse(fs.readFileSync(statsPath, "utf-8"));
  return statsFile;
}

/**
 * Flatten the nested stats object into array of {fullKey, category, key, value}
 * @param {object} allStats
 * @returns {Array}
 */
export function flattenStats(allStats) {
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
  return flattened;
}

/**
 * Filter stats by a search string matching fullKey, category, or key,
 * returning only the closest matches based on a simple similarity score.
 *
 * @param {Array} statsArray
 * @param {string} filterStat
 * @returns {Array} filtered and sorted by best match score (descending)
 */
export function filterStats(statsArray, filterStat) {
  if (!filterStat) return statsArray;

  const filter = filterStat.toLowerCase();

  // ---- Hardcoded disambiguation ----
  if (filter === "killed") {
    return statsArray.filter((s) => s.category === "minecraft:killed");
  }
  if (filter === "killed_by") {
    return statsArray.filter((s) => s.category === "minecraft:killed_by");
  }

  // ---- Tokenizer and Scoring Helpers ----
  function tokenize(str) {
    return str.toLowerCase().split(/[:._\-\s]+/);
  }

  function scoreToken(token, filter) {
    if (token === filter) return 1;
    if (token.startsWith(filter)) return filter.length / token.length;
    if (token.includes(filter)) return filter.length / (2 * token.length);
    return 0;
  }

  const filterTokens = tokenize(filter);
  const categorySet = new Set(statsArray.map((s) => s.category));

  let bestCategory = null;
  let bestScore = 0;

  // ---- Step 1: Category scoring ----
  for (const category of categorySet) {
    const tokens = tokenize(category);
    let categoryScore = 0;

    for (const fToken of filterTokens) {
      for (const token of tokens) {
        categoryScore = Math.max(categoryScore, scoreToken(token, fToken));
      }
    }

    if (categoryScore > bestScore) {
      bestCategory = category;
      bestScore = categoryScore;
    }
  }

  // ---- Step 2: Use best category if good enough ----
  if (bestScore >= 0.6) {
    return statsArray.filter((s) => s.category === bestCategory);
  }

  // ---- Step 3: Fallback to stat-level scoring ----
  const scoredStats = statsArray.map((stat) => {
    const values = [stat.fullKey, stat.category, stat.key];
    let best = 0;
    for (const fToken of filterTokens) {
      for (const val of values) {
        const tokens = tokenize(val);
        for (const token of tokens) {
          best = Math.max(best, scoreToken(token, fToken));
        }
      }
    }
    return { ...stat, score: best };
  });

  return scoredStats
    .filter((s) => s.score >= 0.4)
    .sort((a, b) => b.score - a.score);
}
