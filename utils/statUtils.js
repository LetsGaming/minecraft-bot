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

  function tokenize(str) {
    return str.toLowerCase().split(/[:._\-\s]+/);
  }

  function scoreToken(token, filter) {
    if (token === filter) return 1;
    if (token.startsWith(filter)) return filter.length / token.length;
    return 0;
  }

  const filterTokens = tokenize(filterStat);

  // Scoring function, with category exact match boosting
  function scoreStat(stat) {
    const categoryTokens = tokenize(stat.category);
    const keyTokens = tokenize(stat.key);

    // If filter matches category exactly (all filter tokens match category tokens)
    // AND filter is single token or matches exactly the category tokens combined,
    // score is max (1) for all stats in that category
    // This covers case: filter 'killed' matches category 'killed' but not 'killed_by'

    if (
      filterTokens.length === 1 &&
      categoryTokens.length === 1 &&
      filterTokens[0] === categoryTokens[0]
    ) {
      return 1; // full category match, full score
    }

    // Otherwise, score category and key tokens separately,
    // category tokens get higher weight (0.7), key tokens less (0.3)
    // so matching category is preferred but keys can refine search

    let maxCategoryScore = 0;
    for (const catToken of categoryTokens) {
      for (const fToken of filterTokens) {
        const s = scoreToken(catToken, fToken);
        if (s > maxCategoryScore) maxCategoryScore = s;
      }
    }

    let maxKeyScore = 0;
    for (const keyToken of keyTokens) {
      for (const fToken of filterTokens) {
        const s = scoreToken(keyToken, fToken);
        if (s > maxKeyScore) maxKeyScore = s;
      }
    }

    // Weighted combined score
    return 0.7 * maxCategoryScore + 0.3 * maxKeyScore;
  }

  // Calculate scores for all stats
  const scored = statsArray
    .map((stat) => ({ stat, score: scoreStat(stat) }))
    .filter(({ score }) => score > 0);

  if (scored.length === 0) return [];

  // Find max score and filter by 80% threshold
  const maxScore = Math.max(...scored.map(({ score }) => score));
  const threshold = maxScore * 0.8;

  return scored
    .filter(({ score }) => score >= threshold)
    .sort((a, b) => b.score - a.score)
    .map(({ stat }) => stat);
}
