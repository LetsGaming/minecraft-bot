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
} from "../stores/dailyStore.js";
import { loadLinkedAccountsOrEmpty } from "../stores/linkStore.js";
import { liveStreak } from "./rewards.js";
import { formatRankLine } from "./statUtils.js";
import type { LeaderboardData } from "../../types/index.js";

import { t } from "../i18n.js";
export const STREAK_STAT_KEYS = ["streak", "longest_streak"] as const;
export type StreakStatKey = (typeof STREAK_STAT_KEYS)[number];

export function isStreakStatKey(key: string): key is StreakStatKey {
  // Widen the const tuple to readonly string[] so .includes accepts an
  // arbitrary string (TS otherwise restricts the arg to the literal union).
  return (STREAK_STAT_KEYS as readonly string[]).includes(key);
}

/** Read through the locale on each access, so a label follows the guild's language. */
export const STREAK_STAT_LABELS: Record<StreakStatKey, string> = {
  get streak(): string {
    return t("leaderboard.stat.streak");
  },
  get longest_streak(): string {
    return t("leaderboard.stat.longest_streak");
  },
};

export async function buildStreakLeaderboard(
  statKey: StreakStatKey,
  serverId: string,
  limit = 10,
): Promise<LeaderboardData> {
  const [store, linked] = await Promise.all([
    loadClaimedStore(),
    loadLinkedAccountsOrEmpty(),
  ]);
  const claims = getServerClaims(store, serverId);

  const entries = Object.entries(claims)
    .map(([discordId, data]) => ({
      name: linked[discordId] ?? `<@${discordId}>`,
      value:
        statKey === "streak"
          ? liveStreak(data)
          : (data.longestStreak ?? 0),
    }))
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);

  const lines = entries.map((e, i) =>
    formatRankLine(i, e.name, `🔥 ${t("streak.days", { count: e.value })}`),
  );

  return {
    entries: entries.map((e) => ({
      name: e.name,
      value: e.value,
      formatted: `${e.value}`,
    })),
    title: t("leaderboard.streakTitle", {
      stat: STREAK_STAT_LABELS[statKey],
      server: serverId,
    }),
    description:
      lines.length > 0 ? lines.join("\n") : t("leaderboard.noClaims"),
    footerText: t("leaderboard.streakNote", { limit }),
  };
}
