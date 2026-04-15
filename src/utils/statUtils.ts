import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { type EmbedBuilder } from 'discord.js';
import { getServerConfig } from './server.js';
import { getLevelName, loadJson, loadWhitelist, deleteStats } from './utils.js';
import { createEmbed } from './embedUtils.js';
import { log } from './logger.js';
import type {
  FlattenedStat,
  ScoredStat,
  LeaderboardStatDefinition,
  LeaderboardEntry,
  MinecraftStatsFile,
} from '../types/index.js';

/**
 * Available leaderboard stat definitions.
 * Each entry defines how to extract and format a stat from flattened player data.
 */
export const LEADERBOARD_STATS: Record<string, LeaderboardStatDefinition> = {
  playtime: {
    label: 'Playtime',
    extract: (flat) => findPlayTimeStat(flat),
    format: (v) => formatPlaytime(v),
    sortAscending: false,
  },
  mob_kills: {
    label: 'Mob Kills',
    extract: (flat) =>
      flat
        .filter((s) => s.category === 'minecraft:killed')
        .reduce((sum, s) => sum + s.value, 0),
    format: (v) => v.toLocaleString(),
    sortAscending: false,
  },
  deaths: {
    label: 'Deaths',
    extract: (flat) => {
      const d = flat.find((s) => s.key === 'minecraft:deaths');
      return d?.value ?? 0;
    },
    format: (v) => v.toLocaleString(),
    sortAscending: true,
  },
  mined: {
    label: 'Blocks Mined',
    extract: (flat) =>
      flat
        .filter((s) => s.category === 'minecraft:mined')
        .reduce((sum, s) => sum + s.value, 0),
    format: (v) => v.toLocaleString(),
    sortAscending: false,
  },
  walked: {
    label: 'Distance Walked',
    extract: (flat) => {
      const w = flat.find((s) => s.key === 'minecraft:walk_one_cm');
      return w?.value ?? 0;
    },
    format: (v) => formatDistance(v),
    sortAscending: false,
  },
};

interface BuildLeaderboardOptions {
  limit?: number;
  baseline?: Record<string, Record<string, number>> | null;
  periodLabel?: string | null;
}

/**
 * Shared leaderboard builder used by /leaderboard, /top, and the scheduled poster.
 */
export async function buildLeaderboard(
  statKey: string,
  { limit = 10, baseline = null, periodLabel = null }: BuildLeaderboardOptions = {},
): Promise<{ embed: EmbedBuilder; entries: LeaderboardEntry[] }> {
  const def = LEADERBOARD_STATS[statKey];
  if (!def) throw new Error(`Unknown stat: ${statKey}`);

  const allStats = await loadAllStats();
  const whitelist = (await loadWhitelist()) ?? [];

  const uuidToName: Record<string, string> = {};
  for (const p of whitelist) uuidToName[p.uuid] = p.name;

  const entries: LeaderboardEntry[] = [];

  for (const [uuid, statsFile] of Object.entries(allStats)) {
    const name = uuidToName[uuid];

    // Clean up stats for players no longer on the whitelist
    if (!name) {
      await deleteStats(uuid);
      continue;
    }

    const flat = flattenStats(statsFile);
    let value = def.extract(flat);

    // In delta mode, subtract the baseline value
    if (baseline) {
      const base = baseline[uuid]?.[statKey] ?? 0;
      value = value - base;
    }

    // For deaths include zero values, for everything else skip them
    if (statKey !== 'deaths' && value <= 0) continue;

    entries.push({ name, value, formatted: def.format(value) });
  }

  entries.sort((a, b) =>
    def.sortAscending ? a.value - b.value : b.value - a.value,
  );

  const top = entries.slice(0, limit);
  const medals = ['🥇', '🥈', '🥉'];
  const lines = top.map((e, i) => {
    const prefix = medals[i] ?? `**${i + 1}.**`;
    return `${prefix} **${e.name}** — ${e.formatted}`;
  });

  const titlePeriod = periodLabel ? ` (${periodLabel})` : '';
  const embed = createEmbed({
    title: `🏆 Leaderboard — ${def.label}${titlePeriod}`,
    description: lines.join('\n') || 'No data available.',
    footer: { text: `${entries.length} players tracked` },
  });

  return { embed, entries };
}

export function humanizeKey(rawKey: string): string {
  return rawKey
    .replace(/^minecraft:/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Format playtime in ticks to a human-readable string.
 * 1 tick = 1/20 second.
 */
export function formatPlaytime(ticks: number): string {
  if (typeof ticks !== 'number' || ticks <= 0) return '0s';
  const seconds = Math.floor(ticks / 20);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

/**
 * Find the playtime stat across both new and old formats.
 */
export function findPlayTimeStat(flattenedStats: FlattenedStat[]): number {
  if (!flattenedStats || flattenedStats.length === 0) return 0;

  const playtime = flattenedStats.find(
    (stat) =>
      (stat.key === 'minecraft:play_time' &&
        stat.category === 'minecraft:custom') ||
      stat.fullKey === 'stat.playOneMinute',
  );

  return playtime ? playtime.value : 0;
}

/**
 * Format a distance value in centimeters to a human-readable string.
 */
export function formatDistance(value: number): string {
  const totalMeters = value / 100;
  const kilometers = Math.floor(totalMeters / 1000);
  const meters = (totalMeters % 1000).toFixed(2);

  return `${kilometers}km ${meters}m`;
}

async function getStatsPath(uuid?: string): Promise<string> {
  const levelName = (await getLevelName()) || 'world';
  if (uuid) {
    return path.resolve(
      getServerConfig().serverDir,
      levelName,
      'stats',
      `${uuid}.json`,
    );
  }
  return path.resolve(getServerConfig().serverDir, levelName, 'stats');
}

/**
 * Load and parse stats JSON for given UUID.
 */
export async function loadStats(uuid: string): Promise<MinecraftStatsFile | null> {
  const statsPath = await getStatsPath(uuid);

  const statsFile = (await loadJson(statsPath)) as MinecraftStatsFile | null;
  if (!statsFile) {
    log.warn('stats', `Stats file not found for UUID: ${uuid}`);
    return null;
  }

  return statsFile;
}

/**
 * Load all stats files from the server directory.
 * Results are cached for 30 seconds to avoid redundant directory scans
 * on burst requests (e.g. multiple /leaderboard calls close together).
 * Call invalidateAllStatsCache() after writes that affect aggregate data.
 */

const ALL_STATS_TTL_MS = 30_000;
let allStatsCache: { data: Record<string, MinecraftStatsFile>; at: number } | null = null;

export function invalidateAllStatsCache(): void {
  allStatsCache = null;
}

export async function loadAllStats(): Promise<Record<string, MinecraftStatsFile>> {
  if (allStatsCache && Date.now() - allStatsCache.at < ALL_STATS_TTL_MS) {
    return allStatsCache.data;
  }

  const statsDir = await getStatsPath();
  if (!fs.existsSync(statsDir)) {
    log.error('stats', `Stats directory does not exist: ${statsDir}`);
    return {};
  }

  const files = await fsPromises.readdir(statsDir);
  const statFiles = files.filter((file) => file.endsWith('.json'));

  const results = await Promise.all(
    statFiles.map(async (file) => {
      const uuid = file.slice(0, -5);
      const statsPath = path.join(statsDir, file);
      const data = (await loadJson(statsPath)) as MinecraftStatsFile;
      return [uuid, data] as const;
    }),
  );

  const data = Object.fromEntries(results);
  allStatsCache = { data, at: Date.now() };
  return data;
}

/**
 * Flatten stats into an array of { fullKey, category, key, value }.
 * Works for both older flat format and newer nested format.
 */
export function flattenStats(statsFile: MinecraftStatsFile): FlattenedStat[] {
  const allStats: Record<string, unknown> = statsFile.stats
    ? statsFile.stats
    : (statsFile as Record<string, unknown>);
  const flattened: FlattenedStat[] = [];

  const keys = Object.keys(allStats);
  const isFlatFormat = keys.some((k) => k.includes('.'));

  if (isFlatFormat) {
    for (const fullKey of keys) {
      const value = allStats[fullKey];
      if (typeof value !== 'number') continue;
      const parts = fullKey.split('.');
      let category: string;
      let key: string;

      if (!fullKey.startsWith('stat.')) {
        category = parts[0] ?? fullKey;
        key = parts.slice(1).join('.');
      } else {
        category = parts.slice(0, 2).join('.');
        key = parts.slice(2).join('.');
      }

      flattened.push({ fullKey, category, key, value });
    }
  } else {
    for (const category of keys) {
      const group = allStats[category];
      if (typeof group !== 'object' || group === null) continue;
      for (const key of Object.keys(group)) {
        const value = (group as Record<string, unknown>)[key];
        if (typeof value !== 'number') continue;
        flattened.push({
          fullKey: `${category}.${key}`,
          category,
          key,
          value,
        });
      }
    }
  }

  return flattened;
}

/**
 * Filter stats by a search string.
 * Returns best matches sorted by simple similarity score.
 */
export function filterStats(statsArray: FlattenedStat[], filterStat: string | null): FlattenedStat[] {
  if (!filterStat) return statsArray;

  const filter = filterStat.toLowerCase();

  // Hardcoded disambiguation
  if (filter === 'killed')
    return statsArray.filter((s) => s.category === 'minecraft:killed');
  if (filter === 'killed_by')
    return statsArray.filter(
      (s) =>
        s.category.includes('KilledBy') || s.category === 'minecraft:killed_by',
    );

  const tokenize = (str: string): string[] => str.toLowerCase().split(/[:._\-\s]+/);

  const scoreToken = (token: string, filterStr: string): number => {
    if (token === filterStr) return 1;
    if (token.startsWith(filterStr)) return filterStr.length / token.length;
    if (token.includes(filterStr)) return filterStr.length / (2 * token.length);
    return 0;
  };

  const filterTokens = tokenize(filter);
  const categorySet = new Set(statsArray.map((s) => s.category));

  let bestCategory: string | null = null;
  let bestScore = 0;

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

  if (bestScore >= 0.6 && bestCategory !== null)
    return statsArray.filter((s) => s.category === bestCategory);

  const scoredStats: ScoredStat[] = statsArray.map((stat) => {
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