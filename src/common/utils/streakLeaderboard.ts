/**
 * Streak leaderboards — current and longest daily streak per server,
 * from claimedDaily.json instead of the Minecraft stats files.
 *
 * Streaks are keyed by Discord user, not player UUID, so this lives
 * beside buildLeaderboard rather than as a LEADERBOARD_STATS category:
 * names resolve to the linked Minecraft account when there is one, and
 * fall back to a Discord mention (which renders in embeds) otherwise.
 * Period baselines don't apply — a streak IS its own running total.
 */
import {
  loadClaimedStore,
  getServerClaims,
} from "./dailyStore.js";
import { loadLinkedAccounts } from "./linkUtils.js";
import type { LeaderboardData } from "../types/index.js";

export const STREAK_STAT_KEYS = ["streak", "longest_streak"] as const;
export type StreakStatKey = (typeof STREAK_STAT_KEYS)[number];

export function isStreakStatKey(key: string): key is StreakStatKey {
  return (STREAK_STAT_KEYS as readonly string[]).includes(key);
}

export const STREAK_STAT_LABELS: Record<StreakStatKey, string> = {
  streak: "Current Daily Streak",
  longest_streak: "Longest Daily Streak",
};

export async function buildStreakLeaderboard(
  statKey: StreakStatKey,
  serverId: string,
  limit = 10,
): Promise<LeaderboardData> {
  const [store, linked] = await Promise.all([
    loadClaimedStore(),
    loadLinkedAccounts().catch(() => ({}) as Record<string, string>),
  ]);
  const claims = getServerClaims(store, serverId);

  const entries = Object.entries(claims)
    .map(([discordId, data]) => ({
      name: linked[discordId] ?? `<@${discordId}>`,
      value:
        statKey === "streak"
          ? (data.currentStreak ?? 0)
          : (data.longestStreak ?? 0),
    }))
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);

  const medals = ["🥇", "🥈", "🥉"];
  const lines = entries.map((e, i) => {
    const rank = medals[i] ?? `**${i + 1}.**`;
    return `${rank} ${e.name} — ${e.value} day(s)`;
  });

  return {
    entries: entries.map((e) => ({
      name: e.name,
      value: e.value,
      formatted: `${e.value}`,
    })),
    title: `🏆 ${STREAK_STAT_LABELS[statKey]} — ${serverId}`,
    description:
      lines.length > 0 ? lines.join("\n") : "No claims on this server yet.",
    footerText: `Top ${limit} · /daily streaks are per server`,
  };
}
