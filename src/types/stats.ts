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

export type LeaderboardInterval = "daily" | "weekly" | "monthly";

export interface SnapshotData {
  /** Snapshot format version. Absent or 1 = legacy (no flatStats). */
  version?: number;
  timestamp: number;
  /** Per-player leaderboard stat values (small, hot path). */
  players: Record<string, Record<string, number>>;
  /** Per-player full flattened stat map (uuid -> fullKey -> value). v2+. */
  flatStats?: Record<string, Record<string, number>>;
}
