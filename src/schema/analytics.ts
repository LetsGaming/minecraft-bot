/**
 * Dashboard analytics DTOs and the retention ceilings behind them.
 *
 * Each section of the Analytics view is backed by a store with its own
 * retention, so a requested range is clamped per section and the response
 * says what it actually covered. The ceilings live here because the backend
 * clamps with them and the frontend labels with them.
 *
 * Isomorphic: no Node imports.
 */

import type { LeaderboardEntry } from "./stats.js";

const DAY_HOURS = 24;

/** Longest range, in hours, each analytics section can answer. */
export const ANALYTICS_CAP_HOURS = {
  /** player_count_hours keeps 14 days of hourly buckets. */
  activity: 14 * DAY_HOURS,
  /** uptime_checks keeps about 30 days of one-minute checks. */
  uptime: 30 * DAY_HOURS,
  /** Snapshots are kept for the longest leaderboard period plus two days. */
  leaderboard: 32 * DAY_HOURS,
  /** command_usage keeps 90 days. */
  commands: 90 * DAY_HOURS,
} as const;

export type AnalyticsSection = keyof typeof ANALYTICS_CAP_HOURS;

export type AnalyticsCaps = Record<AnalyticsSection, number>;

/** One uptime window's raw counts. */
export interface UptimeChecks {
  total: number;
  online: number;
}

/** Uptime over the caller's range, next to the fixed 24h / 7d / 30d windows. */
export interface UptimeRangeWindow {
  /** The range actually computed, after clamping to the retained history. */
  rangeHours: number;
  pct: number | null;
  checks: UptimeChecks;
}

export interface UptimeStats {
  /** Percentage 0-100, null if no data for the window */
  pct24h: number | null;
  pct7d: number | null;
  pct30d: number | null;
  checks24h: UptimeChecks;
  checks7d: UptimeChecks;
  checks30d: UptimeChecks;
  currentState: "online" | "offline" | "unknown";
  /** How long the server has been in its current state (ms) */
  currentStateDuration: number;
  /**
   * Hourly uptime sparkline for the last 24 h, oldest hour first.
   * One block char per hour (scaled by that hour's uptime %), "·" for
   * hours without any checks.
   */
  sparkline24h: string;
  /** Present when a custom range was requested. */
  range?: UptimeRangeWindow;
}

export interface ActivityHour {
  at: number;
  /** Mean concurrent players in that hour. */
  avg: number;
  peak: number;
  samples: number;
}

export interface BusyHour {
  hour: number;
  avg: number;
}

export interface ServerAnalyticsResponse {
  uptime: UptimeStats;
  activity: {
    /** The resolved (clamped) range. */
    rangeHours: number;
    hours: ActivityHour[];
    busiest: BusyHour[];
  };
  caps: AnalyticsCaps;
}

export interface PlayerRow {
  name: string;
  /** Playtime inside the requested range only. */
  playtimeMs: number;
  /** Sessions inside the range, out of the retained ones (see sessionsKeptPerPlayer). */
  sessions: number;
  lastSeen: number | null;
  online: boolean;
  firstSeen: number | null;
}

export interface PlayersResponse {
  players: PlayerRow[];
  totalPlayers: number;
  rangeHours: number;
  /** The bot keeps only this many sessions per player, so session counts and playtime cover at most those. */
  sessionsKeptPerPlayer: number;
}

export interface StatOption {
  key: string;
  label: string;
}

export interface LeaderboardResponse {
  stat: string;
  title: string;
  entries: LeaderboardEntry[];
  stale: { asOf: number; reason: string } | null;
  available: StatOption[];
  /** The resolved range, or null for an all-time board. */
  rangeHours: number | null;
  /** When the baseline snapshot was taken, or null when the board is all-time. */
  baselineAt: number | null;
  /**
   * True when the snapshot history does not reach back as far as the range
   * (or no snapshot exists), so the board covers less time than asked for.
   */
  historyShorterThanRange: boolean;
  caps: AnalyticsCaps;
}

export interface CommandUsageRow {
  command: string;
  surface: string;
  uses: number;
  users: number;
  lastUsed: number | null;
}

export interface CommandUsageResponse {
  since: number;
  rangeHours: number;
  commands: CommandUsageRow[];
  caps: AnalyticsCaps;
}
