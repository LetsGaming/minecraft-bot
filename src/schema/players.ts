/**
 * Dashboard player-audit DTOs: the searchable player list and the
 * per-player detail view.
 *
 * Everything here is assembled from stores that already exist (sessions,
 * notes, links, whitelist audit, applications, temp bans, daily claims,
 * stats); nothing is collected for this page. The detail splits into a base
 * part anyone with `server:read` sees and a `sensitive` part that needs
 * `audit:read` on that server, because it joins a Minecraft name to a
 * Discord account and to moderation notes.
 *
 * Isomorphic: no Node imports.
 */

import type { PlayerRow } from "./analytics.js";

export const PLAYER_STATUS_FILTERS = ["all", "online", "quiet", "new"] as const;
export type PlayerStatusFilter = (typeof PLAYER_STATUS_FILTERS)[number];

export const PLAYER_SORT_FIELDS = [
  "name",
  "playtimeMs",
  "sessions",
  "lastSeen",
  "firstSeen",
] as const;
export type PlayerSortField = (typeof PLAYER_SORT_FIELDS)[number];

export interface PlayerListResponse {
  players: PlayerRow[];
  /** Players matching the filters, before paging. */
  total: number;
  /** The window the playtime and session columns cover, after clamping. */
  rangeHours: number;
  /** Sessions are kept this many days. */
  historyDays: number;
  limit: number;
  offset: number;
}

export interface PlayerSessionDto {
  joinedAt: number;
  /** null while the session is open. */
  leftAt: number | null;
}

export interface PlayerDayPlaytime {
  /** Start of the UTC day (epoch ms). */
  day: number;
  playtimeMs: number;
}

export interface PlayerStatValue {
  key: string;
  label: string;
  value: number;
  /** The value as the leaderboard prints it (durations, distances). */
  formatted: string;
}

export interface PlayerActivity {
  online: boolean;
  firstSeen: number | null;
  lastSeen: number | null;
  /** Retained sessions and the time played in them. */
  sessions: number;
  playtimeMs: number;
  longestSessionMs: number;
  /** Newest first. */
  recentSessions: PlayerSessionDto[];
  /** One entry per UTC day with play, oldest first, for the last 90 days. */
  daily: PlayerDayPlaytime[];
  historyDays: number;
}

export interface PlayerLink {
  discordId: string;
  /** null when Discord could not be asked (no token, rate limit, unknown user). */
  displayName: string | null;
}

export interface PlayerWhitelistEntry {
  addedBy: string | null;
  addedAt: string | null;
  removedBy: string | null;
  removedAt: string | null;
  server: string | null;
}

export interface PlayerNoteDto {
  text: string;
  author: string;
  createdAt: string;
}

export interface PlayerApplicationDto {
  id: string;
  status: "approved" | "denied";
  userTag: string;
  note: string | null;
  createdAt: number;
  decidedBy: string | null;
  decidedAt: number | null;
}

export interface PlayerTempBan {
  expiresAt: number;
  bannedAt: number;
  by: string;
  reason: string;
}

export interface PlayerStreak {
  current: number;
  longest: number;
  lastClaim: number | null;
}

/** The part of a player's detail that needs `audit:read` on the server. */
export interface PlayerSensitive {
  link: PlayerLink | null;
  whitelist: PlayerWhitelistEntry | null;
  notes: PlayerNoteDto[];
  applications: PlayerApplicationDto[];
  tempBan: PlayerTempBan | null;
  streak: PlayerStreak | null;
}

export interface PlayerDetail {
  serverId: string;
  /** Casing from the player's most recent join, or the name as asked. */
  name: string;
  /** Dashless lowercase UUID, null when the server could not name one. */
  uuid: string | null;
  activity: PlayerActivity;
  /** null when the server's stats could not be read or the player has no stats file. */
  stats: PlayerStatValue[] | null;
  /** Whether the requester may see {@link PlayerSensitive}. */
  sensitiveAccess: boolean;
  sensitive: PlayerSensitive | null;
}
