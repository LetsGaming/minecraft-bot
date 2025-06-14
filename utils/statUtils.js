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
    return str.toLowerCase().split(/[_\-\s]+/);
  }

  // Simple similarity score between token and filterStat:
  // 1 if exact match,
  // fraction if token startsWith filterStat,
  // 0 else.
  function scoreToken(token, filter) {
    if (token === filter) return 1;
    if (token.startsWith(filter)) return filter.length / token.length;
    return 0;
  }

  // Compute score for a stat
  function scoreStat(stat) {
    const tokens = [
      ...tokenize(stat.fullKey),
      ...tokenize(stat.category),
      ...tokenize(stat.key),
    ];

    let maxScore = 0;
    for (const token of tokens) {
      const s = scoreToken(token, filterStat);
      if (s > maxScore) maxScore = s;
    }
    return maxScore;
  }

  // Attach scores, filter out zero scores
  const scored = statsArray
    .map((stat) => ({ stat, score: scoreStat(stat) }))
    .filter(({ score }) => score > 0);

  if (scored.length === 0) return [];

  // Find max score
  const maxScore = Math.max(...scored.map(({ score }) => score));

  // Threshold: keep those with score >= 80% of maxScore
  const threshold = maxScore * 0.8;

  // Filter by threshold and sort descending
  return scored
    .filter(({ score }) => score >= threshold)
    .sort((a, b) => b.score - a.score)
    .map(({ stat }) => stat);
}
