// ── Config types ──────────────────────────────────────────────────────────────

import type { LeaderboardInterval } from "./stats.js";

export interface RawServerConfig {
  id?: string;
  serverDir?: string;
  linuxUser?: string;
  screenSession?: string;
  useRcon?: boolean;
  rconHost?: string;
  rconPort?: string | number;
  rconPassword?: string;
  scriptDir?: string;
  /**
   * Base URL of the API wrapper running on the MC server VM.
   * Example: "http://192.168.1.10:3000"
   * When set, all filesystem/shell operations for this instance are
   * forwarded to that API wrapper instead of running locally.
   * Omit (or leave empty) for same-VM / local operation — existing behaviour.
   */
  apiUrl?: string;
  /** Shared secret sent as x-api-key to the API wrapper. */
  apiKey?: string;
}

export interface ServerConfig {
  id: string;
  serverDir: string;
  linuxUser: string;
  screenSession: string;
  useRcon: boolean;
  rconHost: string;
  rconPort: number;
  rconPassword: string;
  scriptDir: string;
  apiUrl?: string;
  apiKey?: string;
}

export interface GuildNotificationConfig {
  channelId?: string;
  events?: string[];
}

export interface GuildChatBridgeConfig {
  channelId?: string;
  server?: string;
}

export interface GuildLeaderboardConfig {
  channelId?: string;
  interval?: LeaderboardInterval;
  /** Which server instance to source leaderboard stats from. Defaults to the guild's defaultServer. */
  server?: string;
}

/**
 * The status embed feature is fully self-provisioning — the bot creates its
 * own category and channels. No channelId configuration is required.
 * Set `enabled: true` in your guild config to activate it.
 */
export interface GuildStatusEmbedConfig {
  enabled?: boolean;
}

export interface GuildDowntimeAlertsConfig {
  channelId?: string;
  server?: string;
}

export interface GuildTpsAlertsConfig {
  channelId?: string;
  server?: string;
}

export interface GuildChannelPurgeConfig {
  channelId?: string;
}

export interface GuildConfig {
  defaultServer?: string;
  notifications?: GuildNotificationConfig;
  chatBridge?: GuildChatBridgeConfig;
  leaderboard?: GuildLeaderboardConfig;
  statusEmbed?: GuildStatusEmbedConfig;
  downtimeAlerts?: GuildDowntimeAlertsConfig;
  tpsAlerts?: GuildTpsAlertsConfig;
  channelPurge?: GuildChannelPurgeConfig;
}

export interface CommandOverrideConfig {
  enabled?: boolean;
  url?: string;
}

export interface RawBotConfig {
  token: string;
  clientId: string;
  servers?: Record<string, RawServerConfig>;
  guilds?: Record<string, GuildConfig>;
  adminUsers?: string[];
  commands?: Record<string, CommandOverrideConfig>;
  leaderboard?: Record<string, unknown>;
  tpsWarningThreshold?: number;
  tpsPollIntervalMs?: number;
  leaderboardInterval?: LeaderboardInterval;
}

export interface BotConfig {
  token: string;
  clientId: string;
  servers: Record<string, ServerConfig>;
  guilds: Record<string, GuildConfig>;
  adminUsers: string[];
  commands: Record<string, CommandOverrideConfig>;
  leaderboard: Record<string, unknown>;
  tpsWarningThreshold: number;
  tpsPollIntervalMs: number;
  leaderboardInterval: LeaderboardInterval;
}

/** Variables.txt key-value map */
export type VariablesMap = Record<string, string>;
