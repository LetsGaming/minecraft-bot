// ── Stats & leaderboard types ─────────────────────────────────────────────────

export interface FlattenedStat {
  fullKey: string;
  category: string;
  key: string;
  value: number;
}

export interface ScoredStat extends FlattenedStat {
  score: number;
}

export interface LeaderboardStatDefinition {
  label: string;
  extract: (flat: FlattenedStat[]) => number;
  format: (v: number) => string;
  sortAscending: boolean;
}

export interface LeaderboardEntry {
  name: string;
  value: number;
  formatted: string;
}

// ── Leaderboard periods ─────────────────────────────────────────────────────
// The interval keys and their durations are one contract, shared by every
// layer that reasons about a leaderboard period:
//   - the scheduler turns the configured key into a period length,
//   - the snapshot retention policy sizes its history from the longest
//     period, so the baseline a board needs is still on disk when it runs.
// A period is only meaningful if a snapshot old enough to serve as its
// baseline survives cleanup, so these two must never drift apart.

/** Every interval a scheduled leaderboard may be configured with. */
export const LEADERBOARD_INTERVALS = ["daily", "weekly", "monthly"] as const;

export type LeaderboardInterval = (typeof LEADERBOARD_INTERVALS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/** How much time each leaderboard interval covers. */
export const LEADERBOARD_INTERVAL_MS: Record<LeaderboardInterval, number> = {
  daily: DAY_MS,
  weekly: 7 * DAY_MS,
  monthly: 30 * DAY_MS,
};

/** The longest period any leaderboard can cover — what retention must serve. */
export const LONGEST_LEADERBOARD_INTERVAL_MS: number = Math.max(
  ...Object.values(LEADERBOARD_INTERVAL_MS),
);

/** Type guard: is an arbitrary string a known leaderboard interval? */
export function isLeaderboardInterval(
  value: string,
): value is LeaderboardInterval {
  // Widen the const tuple to readonly string[] so .includes accepts an
  // arbitrary string (TS otherwise restricts the arg to the literal union).
  return (LEADERBOARD_INTERVALS as readonly string[]).includes(value);
}

export interface SnapshotData {
  /** Snapshot format version. Absent or 1 = legacy (no flatStats). */
  version?: number;
  timestamp: number;
  /** Per-player leaderboard stat values (small, hot path). */
  players: Record<string, Record<string, number>>;
  /** Per-player full flattened stat map (uuid -> fullKey -> value). v2+. */
  flatStats?: Record<string, Record<string, number>>;
}
