import fs from "fs";
import path from "path";
import config from "../config.json" assert { type: "json" };
import { createEmbed } from "../utils/embed.js";

function humanizeKey(rawKey) {
  return rawKey
    .replace(/^minecraft:/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Builds an array of embeds for displaying player stats.
 * Each embed contains fields grouped by category,
 * with a maximum of 2 fields per embed.
 * The embeds are paginated if there are too many fields.
 * @param {Array} stats - Array of stats objects with keys: fullKey, category, key, value
 * @param {string} username - The player's username to display in the embed title
 * @return {Array} Array of embed objects ready for Discord
 */
export function buildStatsEmbeds(stats, username) {
  const embeds = [];
  let currentEmbed = createEmbed({ title: "PLACEHOLDER" });
  let fieldCount = 0;

  const grouped = groupByCategory(stats);

  for (const [category, entries] of Object.entries(grouped)) {
    const lines = entries.map(
      (s) => `• ${humanizeKey(s.key)}: ${s.value.toLocaleString()}`
    );

    let index = 0;
    let chunkNumber = 1;

    while (index < lines.length) {
      const chunk = [];
      let chunkLength = 0;

      // Build a chunk under 1024 characters
      while (
        index < lines.length &&
        chunkLength + lines[index].length + 1 < 1024
      ) {
        chunk.push(lines[index]);
        chunkLength += lines[index].length + 1;
        index++;
      }

      const name =
        chunkNumber === 1
          ? humanizeKey(category)
          : `${humanizeKey(category)} (${chunkNumber})`;
      const value = chunk.join("\n");

      // If 2 fields already added, push the embed and start a new one
      if (fieldCount >= 2) {
        embeds.push(currentEmbed);
        currentEmbed = createEmbed({ title: "PLACEHOLDER" });
        fieldCount = 0;
      }

      currentEmbed.addFields({
        name,
        value,
        inline: chunk.length <= 3 && chunkLength <= 100,
      });

      fieldCount++;
      chunkNumber++;
    }
  }

  // Push the last embed if it has content
  if (fieldCount > 0) {
    embeds.push(currentEmbed);
  }

  // Set correct titles now that all pages are known
  const totalPages = embeds.length;
  for (let i = 0; i < totalPages; i++) {
    embeds[i].data.title = `Stats for ${username} (Page ${
      i + 1
    }/${totalPages})`;
  }

  return embeds;
}

function groupByCategory(stats) {
  const grouped = {};
  for (const stat of stats) {
    if (!grouped[stat.category]) {
      grouped[stat.category] = [];
    }
    grouped[stat.category].push(stat);
  }
  return grouped;
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
