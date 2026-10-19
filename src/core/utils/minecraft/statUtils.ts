import { getFirstInstance } from "../server/server.js";
import type { ServerInstance } from "../server/server.js";
import { loadKnownPlayers } from "./whitelist.js";
import { log } from "../logger.js";
import { isRecord } from "../objects.js";
import { cached, invalidate, invalidatePrefix } from "../cache.js";
import { mapLimit } from "../concurrency.js";
import { formatSpan } from "../duration.js";
import * as serverAccess from "../server/serverAccess.js";
import type {
  FlattenedStat,
  ScoredStat,
  LeaderboardStatDefinition,
  LeaderboardEntry,
  MinecraftStatsFile,
  BuildLeaderboardOptions,
  LeaderboardData,
} from "../../types/index.js";

import { t, formatNumber } from "../i18n.js";
import { errMsg } from "../error.js";
import { MS } from "@mcbot/schema/time.js";
import { humanizeId } from "./itemNames.js";
export type { BuildLeaderboardOptions, LeaderboardData };

/** A leaderboard stat. Zero values are skipped unless `includeZero` is set. */
export interface StatDefinition extends LeaderboardStatDefinition {
  includeZero?: boolean;
}

type StatBody = Omit<StatDefinition, "label">;

/** The value of one stat key, or 0 when the player has none. */
const statByKey =
  (key: string) =>
  (flat: FlattenedStat[]): number =>
    flat.find((s) => s.key === key)?.value ?? 0;

/** The sum of every stat in a category, optionally limited to some keys. */
const sumCategory =
  (category: string, keys?: readonly string[]) =>
  (flat: FlattenedStat[]): number =>
    flat
      .filter((s) => s.category === category && (!keys || keys.includes(s.key)))
      .reduce((sum, s) => sum + s.value, 0);

const count = (v: number): string => formatNumber(v);

/** The label is read through the locale each time, so it follows the guild's language. */
function defineStat(key: string, body: StatBody): StatDefinition {
  return {
    ...body,
    get label(): string {
      return t(`leaderboard.stat.${key}`);
    },
  };
}

/**
 * Available leaderboard stat definitions.
 * Each entry defines how to extract and format a stat from flattened player data.
 */
export const LEADERBOARD_STATS: Record<string, StatDefinition> = {
  playtime: defineStat("playtime", {
    extract: (flat) => findPlayTimeStat(flat),
    format: (v) => formatSpan(ticksToMs(v)),
    sortAscending: false,
  }),
  mob_kills: defineStat("mob_kills", {
    extract: sumCategory("minecraft:killed"),
    format: count,
    sortAscending: false,
  }),
  deaths: defineStat("deaths", {
    extract: statByKey("minecraft:deaths"),
    format: count,
    sortAscending: true,
    includeZero: true,
  }),
  mined: defineStat("mined", {
    extract: sumCategory("minecraft:mined"),
    format: count,
    sortAscending: false,
  }),
  walked: defineStat("walked", {
    extract: statByKey("minecraft:walk_one_cm"),
    format: (v) => formatDistance(v),
    sortAscending: false,
  }),
  crafted: defineStat("crafted", {
    extract: sumCategory("minecraft:crafted"),
    format: count,
    sortAscending: false,
  }),
  player_kills: defineStat("player_kills", {
    extract: statByKey("minecraft:player_kills"),
    format: count,
    sortAscending: false,
  }),
  jumps: defineStat("jumps", {
    extract: statByKey("minecraft:jump"),
    format: count,
    sortAscending: false,
  }),
  animals_bred: defineStat("animals_bred", {
    extract: statByKey("minecraft:animals_bred"),
    format: count,
    sortAscending: false,
  }),
  fish_caught: defineStat("fish_caught", {
    extract: statByKey("minecraft:fish_caught"),
    format: count,
    sortAscending: false,
  }),
  diamonds: defineStat("diamonds", {
    extract: sumCategory("minecraft:mined", [
      "minecraft:diamond_ore",
      "minecraft:deepslate_diamond_ore",
    ]),
    format: count,
    sortAscending: false,
  }),
};

const MEDALS = ["🥇", "🥈", "🥉"];

/** One leaderboard row: a medal for the top three, the rank number after that. */
export function formatRankLine(index: number, name: string, detail: string): string {
  const rank = MEDALS[index] ?? `**${index + 1}.**`;
  return `${rank} **${name}**: ${detail}`;
}

/**
 * Shared leaderboard builder used by /leaderboard and the scheduled poster.
 * Returns plain data; callers should use buildLeaderboardEmbed() from statEmbeds.ts
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
  // Whitelist + usercache, so boards fill on servers without a whitelist.
  const players = await loadKnownPlayers(srv);

  const uuidToName: Record<string, string> = {};
  for (const p of players) uuidToName[p.uuid] = p.name;

  const entries: LeaderboardEntry[] = [];

  for (const [uuid, statsFile] of Object.entries(allStats)) {
    const name = uuidToName[uuid];

    // A leaderboard is a read: it must never delete player data.
    // Cleanup of departed players is an explicit admin action
    // (/server prune-stats); UUIDs neither source can name are skipped.
    if (!name) continue;

    const flat = flattenStats(statsFile);
    let value = def.extract(flat);

    // In delta mode, subtract the baseline value
    if (baseline) {
      const base = baseline[uuid]?.[statKey] ?? 0;
      value = value - base;
    }

    if (!def.includeZero && value <= 0) continue;

    entries.push({ name, value, formatted: def.format(value) });
  }

  entries.sort((a, b) =>
    def.sortAscending ? a.value - b.value : b.value - a.value,
  );

  const top = entries.slice(0, limit);
  const lines = top.map((e, i) => formatRankLine(i, e.name, e.formatted));

  const titlePeriod = periodLabel ? ` (${periodLabel})` : "";

  return {
    entries,
    title: t("leaderboard.title", { stat: def.label, period: titlePeriod }),
    description: lines.join("\n") || t("leaderboard.noData"),
    footerText: t("leaderboard.tracked", { count: entries.length }),
  };
}

/** A stat key as readable text: "minecraft:walk_one_cm" becomes "Walk One Cm". */
export const humanizeKey = humanizeId;

/** Minecraft counts playtime in game ticks, 20 per second. */
export const MS_PER_TICK = 50;

export function ticksToMs(ticks: number): number {
  return ticks * MS_PER_TICK;
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
  const meters = formatNumber(totalMeters % 1000, { fixed: 2 });

  return t("leaderboard.distance", { km: kilometers, m: meters });
}

/**
 * Load and parse stats JSON for given UUID.
 * Routes through serverAccess so remote instances fetch from the API wrapper.
 */
export async function loadStats(
  uuid: string,
  server?: ServerInstance,
): Promise<MinecraftStatsFile | null> {
  const cfg = (server ?? getFirstInstance())?.config;
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
const ALL_STATS_TTL_MS = 30 * MS.second;
const ALL_STATS_CACHE_PREFIX = "stats:all:";

// Above the wrapper's own per-request concurrency (8), this is only the
// fallback path taken against a wrapper too old to serve /stats/bulk. The
// bound that matters lives server-side once bulk is available.
const STATS_FALLBACK_CONCURRENCY = 6;

export function invalidateAllStatsCache(serverId?: string): void {
  if (serverId) invalidate(`${ALL_STATS_CACHE_PREFIX}${serverId}`);
  else invalidatePrefix(ALL_STATS_CACHE_PREFIX);
}

async function loadAllStatsUncached(
  cfg: ServerInstance["config"],
): Promise<Record<string, MinecraftStatsFile>> {
  // A wrapper new enough to serve every player's stats in one request makes
  // the per-uuid fan-out below unnecessary; try it first and only fall back
  // when it 404s (older wrapper) so a lifetime player count of a few hundred
  // does not become a few hundred simultaneous requests.
  // readAllStats returns null for a wrapper without the route. Any other
  // failure (timeout, 5xx, auth) means the wrapper is unwell, so it is
  // reported instead of being answered with one request per player.
  let bulk;
  try {
    bulk = await serverAccess.readAllStats(cfg);
  } catch (err) {
    log.warn("stats", `Bulk stats read failed for ${cfg.id}: ${errMsg(err)}`);
    throw err;
  }
  if (bulk) return bulk;

  const uuids = await serverAccess.listStatsUuids(cfg);
  const results = await mapLimit(uuids, STATS_FALLBACK_CONCURRENCY, async (uuid) => {
    const statsData = await serverAccess.readStats(cfg, uuid);
    return [uuid, statsData] as const;
  });

  return Object.fromEntries(
    results.filter((r): r is [string, MinecraftStatsFile] => r[1] !== null),
  );
}

export async function loadAllStats(
  server?: ServerInstance,
): Promise<Record<string, MinecraftStatsFile>> {
  const srv = server ?? getFirstInstance();
  const cfg = srv?.config;
  if (!cfg) return {};

  return cached(
    `${ALL_STATS_CACHE_PREFIX}${cfg.id}`,
    ALL_STATS_TTL_MS,
    () => loadAllStatsUncached(cfg),
  );
}

/**
 * Delete a player's stats file, then drop the cached bundle for that
 * server so the next leaderboard read reflects the removal.
 * Admin-gated (/server prune-stats); a read never calls this.
 */
export async function deleteStats(
  uuid: string,
  server: ServerInstance,
): Promise<boolean> {
  const cfg = server.config;
  const deleted = await serverAccess.deleteStatsFile(cfg, uuid);
  if (deleted) invalidateAllStatsCache(cfg.id);
  return deleted;
}

/**
 * Flatten stats into an array of { fullKey, category, key, value }.
 * Works for both older flat format and newer nested format.
 */
export function flattenStats(statsFile: MinecraftStatsFile): FlattenedStat[] {
  const allStats: Record<string, unknown> = statsFile.stats
    ? statsFile.stats
    : isRecord(statsFile)
      ? statsFile
      : {};
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
      if (!isRecord(group)) continue;
      for (const key of Object.keys(group)) {
        const value = group[key];
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
