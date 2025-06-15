import fs from "fs";
import path from "path";
import config from "../config.json" assert { type: "json" };
import { createEmbed } from "../utils/embed.js";

export function buildStatsEmbeds(stats, username) {
  const embeds = [];
  let currentEmbed = createEmbed({
    title: `Stats for ${username}`,
  });
  let totalChars = currentEmbed.data.title.length;
  let fieldCount = 0;

  const categories = groupStatsByCategory(stats);

  for (const [category, entries] of Object.entries(categories)) {
    const lines = entries.map(
      ([statName, value]) => `• **${statName}**: ${value}`
    );

    // If no entries for this category, skip or add fallback text
    if (lines.length === 0) continue;

    const fieldValue = lines.join("\n").slice(0, 1024); // truncate to Discord limit
    const fieldName = category;

    // If fieldValue is empty or whitespace, use fallback text to avoid errors
    const safeFieldValue =
      fieldValue.trim().length > 0 ? fieldValue : "No stats available";

    const fieldLength = fieldName.length + safeFieldValue.length;

    // Check if adding this field would exceed Discord limits
    if (fieldCount >= 25 || totalChars + fieldLength >= 6000) {
      // Save current embed and start a new one
      embeds.push(currentEmbed);
      currentEmbed = createEmbed({
        title: `Stats for ${username} (continued)`,
      });
      totalChars = currentEmbed.data.title.length;
      fieldCount = 0;
    }

    currentEmbed.addFields({
      name: fieldName,
      value: safeFieldValue,
      inline: false,
    });

    totalChars += fieldLength;
    fieldCount += 1;
  }

  // Push last embed
  if (fieldCount > 0) {
    embeds.push(currentEmbed);
  }

  return embeds;
}


function groupStatsByCategory(stats) {
  const result = {};

  for (const [statPath, value] of Object.entries(stats)) {
    const [namespace, ...rest] = statPath.split(".");
    if (!namespace || rest.length === 0) continue;

    const [domain, category] = namespace.split(":");
    if (!domain || !category) continue;

    const statName = rest.join(".");

    if (!result[category]) result[category] = [];
    result[category].push([statName, value]);
  }

  return result;
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
