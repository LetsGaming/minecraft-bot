import { getServerInstance } from "./server.js";
import type { ServerInstance } from "./server.js";
import { loadWhitelist, deleteStats } from "./utils.js";
import { log } from "./logger.js";
import * as serverAccess from "./serverAccess.js";
import type {
  FlattenedStat,
  ScoredStat,
  LeaderboardStatDefinition,
  LeaderboardEntry,
  MinecraftStatsFile,
} from "../types/index.js";

/**
 * Available leaderboard stat definitions.
 * Each entry defines how to extract and format a stat from flattened player data.
 */
export const LEADERBOARD_STATS: Record<string, LeaderboardStatDefinition> = {
  playtime: {
    label: "Playtime",
    extract: (flat) => findPlayTimeStat(flat),
    format: (v) => formatPlaytime(v),
    sortAscending: false,
  },
  mob_kills: {
    label: "Mob Kills",
    extract: (flat) =>
      flat
        .filter((s) => s.category === "minecraft:killed")
        .reduce((sum, s) => sum + s.value, 0),
    format: (v) => v.toLocaleString(),
    sortAscending: false,
  },
  deaths: {
    label: "Deaths",
    extract: (flat) => {
      const d = flat.find((s) => s.key === "minecraft:deaths");
      return d?.value ?? 0;
    },
    format: (v) => v.toLocaleString(),
    sortAscending: true,
  },
  mined: {
    label: "Blocks Mined",
    extract: (flat) =>
      flat
        .filter((s) => s.category === "minecraft:mined")
        .reduce((sum, s) => sum + s.value, 0),
    format: (v) => v.toLocaleString(),
    sortAscending: false,
  },
  walked: {
    label: "Distance Walked",
    extract: (flat) => {
      const w = flat.find((s) => s.key === "minecraft:walk_one_cm");
      return w?.value ?? 0;
    },
    format: (v) => formatDistance(v),
    sortAscending: false,
  },
};

export interface BuildLeaderboardOptions {
  limit?: number;
  baseline?: Record<string, Record<string, number>> | null;
  periodLabel?: string | null;
  /** Which server to pull stats from. Must be provided by the caller. */
  server: ServerInstance;
}

export interface LeaderboardData {
  entries: LeaderboardEntry[];
  title: string;
  description: string;
  footerText: string;
}

/**
 * Shared leaderboard builder used by /leaderboard, /top, and the scheduled poster.
 * Returns plain data — callers should use buildLeaderboardEmbed() from statEmbeds.ts
 * to convert it to a Discord embed.
 */
export async function buildLeaderboard(
  statKey: string,
  {
    limit = 10,
    baseline = null,
    periodLabel = null,
    server,
  }: BuildLeaderboardOptions,
): Promise<LeaderboardData> {
  const def = LEADERBOARD_STATS[statKey];
  if (!def) throw new Error(`Unknown stat: ${statKey}`);

  const srv = server;
  const allStats = await loadAllStats(srv);
  const whitelist = (await loadWhitelist(false, srv)) ?? [];

  const uuidToName: Record<string, string> = {};
  for (const p of whitelist) uuidToName[p.uuid] = p.name;

  // B-03: only delete stats for unlisted players when the whitelist loaded
  // successfully and is non-empty. An empty whitelist most likely means the
  // load failed (API error, missing file) — deleting every player's stats
  // in that case would be irreversible data loss.
  const whitelistLoadedOk = whitelist.length > 0;

  const entries: LeaderboardEntry[] = [];

  for (const [uuid, statsFile] of Object.entries(allStats)) {
    const name = uuidToName[uuid];

    // Clean up stats for players no longer on the whitelist
    if (!name) {
      if (whitelistLoadedOk) await deleteStats(uuid, srv);
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
    if (statKey !== "deaths" && value <= 0) continue;

    entries.push({ name, value, formatted: def.format(value) });
  }

  entries.sort((a, b) =>
    def.sortAscending ? a.value - b.value : b.value - a.value,
  );

  const top = entries.slice(0, limit);
  const medals = ["🥇", "🥈", "🥉"];
  const lines = top.map((e, i) => {
    const prefix = medals[i] ?? `**${i + 1}.**`;
    return `${prefix} **${e.name}** — ${e.formatted}`;
  });

  const titlePeriod = periodLabel ? ` (${periodLabel})` : "";

  return {
    entries,
    title: `🏆 Leaderboard — ${def.label}${titlePeriod}`,
    description: lines.join("\n") || "No data available.",
    footerText: `${entries.length} players tracked`,
  };
}

export function humanizeKey(rawKey: string): string {
  return rawKey
    .replace(/^minecraft:/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Format playtime in ticks to a human-readable string.
 * 1 tick = 1/20 second.
 */
export function formatPlaytime(ticks: number): string {
  if (typeof ticks !== "number" || ticks <= 0) return "0s";
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
      (stat.key === "minecraft:play_time" &&
        stat.category === "minecraft:custom") ||
      stat.fullKey === "stat.playOneMinute",
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

/**
 * Load and parse stats JSON for given UUID.
 * Routes through serverAccess so remote instances fetch from the API wrapper.
 */
export async function loadStats(
  uuid: string,
  server?: ServerInstance,
): Promise<MinecraftStatsFile | null> {
  const cfg = (server ?? getServerInstance("default"))?.config;
  if (!cfg) {
    log.warn("stats", "No server instance available");
    return null;
  }

  const statsFile = await serverAccess.readStats(cfg, uuid);
  if (!statsFile) {
    log.warn("stats", `Stats file not found for UUID: ${uuid}`);
    return null;
  }
  return statsFile;
}

/**
 * Load all stats files for a server.
 * Cached per-server for 30 s. Call invalidateAllStatsCache() after writes.
 */
const ALL_STATS_TTL_MS = 30_000;
const allStatsCaches = new Map<
  string,
  { data: Record<string, MinecraftStatsFile>; at: number }
>();

export function invalidateAllStatsCache(serverId?: string): void {
  if (serverId) allStatsCaches.delete(serverId);
  else allStatsCaches.clear();
}

export async function loadAllStats(
  server?: ServerInstance,
): Promise<Record<string, MinecraftStatsFile>> {
  const srv = server ?? getServerInstance("default");
  const cfg = srv?.config;
  if (!cfg) return {};
  const cacheKey = cfg.id;

  const cached = allStatsCaches.get(cacheKey);
  if (cached && Date.now() - cached.at < ALL_STATS_TTL_MS) return cached.data;

  const uuids = await serverAccess.listStatsUuids(cfg);

  const results = await Promise.all(
    uuids.map(async (uuid) => {
      const statsData = await serverAccess.readStats(cfg, uuid);
      return [uuid, statsData] as const;
    }),
  );

  const data = Object.fromEntries(
    results.filter((r): r is [string, MinecraftStatsFile] => r[1] !== null),
  );
  allStatsCaches.set(cacheKey, { data, at: Date.now() });
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
  const isFlatFormat = keys.some((k) => k.includes("."));

  if (isFlatFormat) {
    for (const fullKey of keys) {
      const value = allStats[fullKey];
      if (typeof value !== "number") continue;
      const parts = fullKey.split(".");
      let category: string;
      let key: string;

      if (!fullKey.startsWith("stat.")) {
        category = parts[0] ?? fullKey;
        key = parts.slice(1).join(".");
      } else {
        category = parts.slice(0, 2).join(".");
        key = parts.slice(2).join(".");
      }

      flattened.push({ fullKey, category, key, value });
    }
  } else {
    for (const category of keys) {
      const group = allStats[category];
      if (typeof group !== "object" || group === null) continue;
      for (const key of Object.keys(group)) {
        const value = (group as Record<string, unknown>)[key];
        if (typeof value !== "number") continue;
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
export function filterStats(
  statsArray: FlattenedStat[],
  filterStat: string | null,
): FlattenedStat[] {
  if (!filterStat) return statsArray;

  const filter = filterStat.toLowerCase();

  // Hardcoded disambiguation
  if (filter === "killed")
    return statsArray.filter((s) => s.category === "minecraft:killed");
  if (filter === "killed_by")
    return statsArray.filter(
      (s) =>
        s.category.includes("KilledBy") || s.category === "minecraft:killed_by",
    );

  const tokenize = (str: string): string[] =>
    str.toLowerCase().split(/[:._\-\s]+/);

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
