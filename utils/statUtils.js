import fs from "fs";
import path from "path";
import config from "../config.json" assert { type: "json" };

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

  filterStat = filterStat.toLowerCase();

  // --- Helpers ---
  function tokenize(str) {
    return str.toLowerCase().split(/[:._\-\s]+/);
  }

  function scoreToken(token, filter) {
    if (token === filter) return 1;
    if (token.startsWith(filter)) return filter.length / token.length;
    if (token.includes(filter)) return filter.length / (2 * token.length);
    return 0;
  }

  const filterTokens = tokenize(filterStat);

  // Exact category match
  const exactCategoryMatches = statsArray.filter(
    (stat) => stat.category.toLowerCase() === filterStat
  );
  if (exactCategoryMatches.length > 0) return exactCategoryMatches;

  // Score categories
  const allCategories = [...new Set(statsArray.map((s) => s.category))];
  const categoryScores = allCategories.map((cat) => {
    const tokens = tokenize(cat);
    let best = 0;
    for (const fToken of filterTokens) {
      for (const token of tokens) {
        const s = scoreToken(token, fToken);
        if (s > best) best = s;
      }
    }
    return { category: cat, score: best };
  });

  const maxCategoryScore = Math.max(...categoryScores.map((c) => c.score));
  const bestCategory = categoryScores.find((c) => c.score === maxCategoryScore);

  if (bestCategory?.score >= 0.5) {
    return statsArray.filter((stat) => stat.category === bestCategory.category);
  }

  // No good category match → fallback to scoring individual stats
  const scoredStats = statsArray.map((stat) => {
    const values = [stat.fullKey, stat.category, stat.key];
    let best = 0;
    for (const fToken of filterTokens) {
      for (const val of values) {
        const tokens = tokenize(val);
        for (const token of tokens) {
          const s = scoreToken(token, fToken);
          if (s > best) best = s;
        }
      }
    }
    return { ...stat, score: best };
  });

  // Filter by score threshold
  const filtered = scoredStats.filter((s) => s.score >= 0.4);
  // Sort descending by score
  return filtered.sort((a, b) => b.score - a.score);
}
