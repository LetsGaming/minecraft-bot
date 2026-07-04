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
   * Example: "http://192.168.1.10:3000" (trusted LAN) or
   * "https://mc-api.example.com" (anything beyond the LAN).
   * When set, all filesystem/shell operations for this instance are
   * forwarded to that API wrapper instead of running locally.
   * Omit (or leave empty) for same-VM / local operation — existing behaviour.
   *
   * Plaintext http:// is only accepted for loopback/private/LAN
   * hosts — the x-api-key and all commands travel unencrypted. Public
   * hosts require https:// (or an explicit allowInsecureHttp override).
   */
  apiUrl?: string;
  /** Shared secret sent as x-api-key to the API wrapper. */
  apiKey?: string;
  /**
   * Opt-out for the plaintext-HTTP-to-public-host rejection.
   * Only for hosts that ARE on a trusted segment but can't be detected as
   * such (e.g. internal DNS names). The key and all commands still travel
   * unencrypted — a loud warning is logged at startup.
   */
  allowInsecureHttp?: boolean;
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

/**
 * Server scoping for guild push features (notifications, TPS/downtime
 * alerts, leaderboard): a single server ID, an explicit list of IDs, or —
 * when omitted — every server this guild can see (all servers in
 * single-guild deployments, the guild's allowed set in multi-guild ones).
 */
export type ServerScope = string | string[];

export interface GuildNotificationConfig {
  channelId?: string;
  events?: string[];
  /** Which server(s) to receive events from — see ServerScope. */
  server?: ServerScope;
}

/**
 * One chat bridge = one Discord channel bound to exactly ONE server, in
 * both directions. `server` may be omitted only when it is unambiguous
 * (guild defaultServer set, or a single configured server). A guild can
 * define several bridges (one channel per server) by using an array.
 */
export interface GuildChatBridgeConfig {
  channelId?: string;
  server?: string;
}

export interface GuildLeaderboardConfig {
  channelId?: string;
  interval?: LeaderboardInterval;
  /**
   * Which server instance(s) to post leaderboards for — one ID, a list
   * (one leaderboard embed per server), or unset for the guild's default.
   */
  server?: ServerScope;
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
  /** One server ID, a list, or unset = every server this guild can see. */
  server?: ServerScope;
}

export interface GuildTpsAlertsConfig {
  channelId?: string;
  /** One server ID, a list, or unset = every server this guild can see. */
  server?: ServerScope;
}

export interface GuildChannelPurgeConfig {
  channelId?: string;
}

export interface GuildConfig {
  defaultServer?: string;
  /**
   * Admins scoped to THIS guild (Discord user IDs and/or role IDs,
   * same semantics as the global adminUsers list). Entries here can use
   * admin commands only in this guild, and only against servers this guild
   * is allowed to target. The global adminUsers list remains operator-level
   * (valid everywhere).
   */
  adminUsers?: string[];
  /**
   * Which server instances commands issued from this guild may
   * target (including via the explicit `server:` option). When unset, the
   * allowed set is derived from the servers referenced in this guild's
   * config (defaultServer, chatBridge.server, notifications.server, …).
   * Only enforced in multi-guild deployments — single-guild setups keep
   * full access to every configured server, as before.
   */
  allowedServers?: string[];
  notifications?: GuildNotificationConfig;
  /** One bridge, or several (one Discord channel per server). */
  chatBridge?: GuildChatBridgeConfig | GuildChatBridgeConfig[];
  leaderboard?: GuildLeaderboardConfig;
  statusEmbed?: GuildStatusEmbedConfig;
  downtimeAlerts?: GuildDowntimeAlertsConfig;
  tpsAlerts?: GuildTpsAlertsConfig;
  channelPurge?: GuildChannelPurgeConfig;
}

export interface CommandOverrideConfig {
  enabled?: boolean;
  url?: string;
  /**
   * Gate this command behind the admin check (global adminUsers or
   * the issuing guild's adminUsers). Useful for commands that write to the
   * game console but are open by default, e.g. `"say": { "adminOnly": true }`.
   */
  adminOnly?: boolean;
}

export interface RawBotConfig {
  token: string;
  clientId: string;
  servers?: Record<string, RawServerConfig>;
  guilds?: Record<string, GuildConfig>;
  /** May contain Discord user IDs and/or role IDs. */
  adminUsers?: string[];
  /** Locale for user-visible bot strings ("en" | "de", default "en"). */
  language?: string;
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
  /** May contain Discord user IDs and/or role IDs. */
  adminUsers: string[];
  /** Locale for user-visible bot strings. */
  language: "en" | "de";
  commands: Record<string, CommandOverrideConfig>;
  leaderboard: Record<string, unknown>;
  tpsWarningThreshold: number;
  tpsPollIntervalMs: number;
  leaderboardInterval: LeaderboardInterval;
}

/** Variables.txt key-value map */
export type VariablesMap = Record<string, string>;
