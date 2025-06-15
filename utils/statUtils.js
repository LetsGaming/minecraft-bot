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

  // --- Tokenization and scoring ---
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

  // --- Exact match by category ---
  const exactCategoryMatches = statsArray.filter(
    (stat) => stat.category.toLowerCase() === filterStat
  );
  if (exactCategoryMatches.length > 0) return exactCategoryMatches;

  // --- Score categories ---
  const categoryScores = new Map(); // category -> score

  for (const stat of statsArray) {
    const cat = stat.category;
    const tokens = tokenize(cat);

    let maxTokenScore = 0;
    for (const fToken of filterTokens) {
      for (const token of tokens) {
        maxTokenScore = Math.max(maxTokenScore, scoreToken(token, fToken));
      }
    }

    // Store highest score for each category only once
    if (!categoryScores.has(cat) || categoryScores.get(cat) < maxTokenScore) {
      categoryScores.set(cat, maxTokenScore);
    }
  }

  // --- Pick best matching category (if score high enough) ---
  const [bestCategory, bestScore] = [...categoryScores.entries()].reduce(
    (best, current) => (current[1] > best[1] ? current : best),
    ["", 0]
  );

  if (bestScore >= 0.6) {
    return statsArray.filter((stat) => stat.category === bestCategory);
  }

  // --- Fallback: score individual stats ---
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
