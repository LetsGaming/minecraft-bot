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
  /**
   * Per-server command overrides for IN-GAME !commands, merged
   * field-by-field over the global `commands` block (see
   * CommandOverrideConfig). Slash commands scope per guild instead.
   */
  commands?: Record<string, CommandOverrideConfig>;
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
  commands?: Record<string, CommandOverrideConfig>;
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
  /**
   * Relay MC→Discord chat through a channel webhook so each line shows
   * the player's name and head as the message author instead of a bot
   * embed. Needs Manage Webhooks in the channel; when the webhook can't
   * be created or used the bridge falls back to the embed form rather
   * than dropping chat.
   */
  useWebhook?: boolean;
}

export interface GuildLeaderboardConfig {
  channelId?: string;
  interval?: LeaderboardInterval;
  /**
   * Which server instance(s) to post leaderboards for — one ID, a list
   * (one leaderboard embed per server), or unset for the guild's default.
   */
  server?: ServerScope;
  /**
   * Which categories the scheduled post includes (one embed per entry).
   * Any LEADERBOARD_STATS key plus "streak" / "longest_streak"; default
   * ["playtime", "mined"] — the pre-configurable behaviour.
   */
  categories?: string[];
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
  /**
   * Role ID mentioned on every downtime, disk, and backup-age alert in
   * this guild, so the on-call person gets pinged instead of hoping
   * someone reads the channel.
   */
  mentionRole?: string;
}

export interface GuildTpsAlertsConfig {
  channelId?: string;
  /** One server ID, a list, or unset = every server this guild can see. */
  server?: ServerScope;
  /** Role ID mentioned on every low-TPS alert in this guild. */
  mentionRole?: string;
}

export interface GuildChannelPurgeConfig {
  channelId?: string;
}

/**
 * Button-based whitelist applications. Both channels are required for
 * the feature to arm: the prompt lives in channelId, applications queue
 * in adminChannelId (which should be admin-only — the decision buttons
 * enforce the admin check regardless).
 */
export interface GuildWhitelistApplicationsConfig {
  channelId?: string;
  adminChannelId?: string;
  /** Optional role pinged on every new application. */
  mentionRole?: string;
}

/**
 * Admin console access: the channel `/console live` relays a server's
 * raw log into. The relay itself is toggled per server at runtime with
 * `/console live enable|disable`; without a channelId here the toggle
 * has nowhere to send.
 */
export interface GuildConsoleConfig {
  channelId?: string;
}

/**
 * In-game `!report` routing: the Discord channel that receives report
 * embeds, an optional role to mention on each report, and the usual
 * server scope (unset = every server this guild can see).
 */
export interface GuildReportsConfig {
  channelId?: string;
  /** Role ID mentioned on every report (e.g. a @Moderator role). */
  mentionRole?: string;
  /** One server ID, a list, or unset = every server this guild can see. */
  server?: ServerScope;
}

export interface GuildConfig {
  defaultServer?: string;
  /**
   * Locale for user-visible bot strings in THIS guild ("en" | "de").
   * Falls back to the global `language` when unset. Applies to slash
   * command replies and per-guild notifications; in-game (!command)
   * strings and DMs follow the global language, since a server instance
   * can serve several guilds.
   */
  language?: string;
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
  /**
   * Role ID assigned to a member when they link their Minecraft account
   * (and removed again on unlink). Requires the bot to have Manage Roles
   * and to sit above the role in the hierarchy — failures are written to
   * the admin audit log and never fail the link itself.
   */
  linkedRole?: string;
  /** In-game `!report` → Discord routing for this guild. */
  reports?: GuildReportsConfig;
  /** Admin-only live console relay target for `/console live`. */
  console?: GuildConsoleConfig;
  /** Button-based whitelist application flow. */
  whitelistApplications?: GuildWhitelistApplicationsConfig;
  /**
   * Per-guild command overrides for SLASH commands, merged field-by-field
   * over the global `commands` block (see CommandOverrideConfig).
   */
  commands?: Record<string, CommandOverrideConfig>;
}

/**
 * Per-command settings, resolvable at three scopes: globally
 * (`commands`), per guild (`guilds.<id>.commands`, slash commands), and
 * per server (`servers.<id>.commands`, in-game !commands). Resolution is
 * FIELD-BY-FIELD: a scope override only changes the fields it sets and
 * inherits the rest, so future fields added here automatically get the
 * same scoped fallback (see common/utils/commandPolicy.ts).
 */
export interface CommandOverrideConfig {
  /**
   * false hides the command in the scope. A command disabled globally
   * but enabled in one scope stays registered and is gated at dispatch.
   */
  enabled?: boolean;
  url?: string;
  /**
   * Gate this command behind the admin check. For slash commands that
   * is the global adminUsers list or the issuing guild's adminUsers;
   * for in-game commands the player's LINKED Discord account must be a
   * global admin. This can only ADD a restriction — built-in admin
   * commands (/server, /config, …) stay admin-gated regardless of what
   * is configured here.
   */
  adminOnly?: boolean;
}

/**
 * Bot presence in the Discord member list, updated on the status-embed
 * cadence. `format` supports {online}, {max} and {server} placeholders.
 * With `server` unset the counts aggregate across every configured
 * instance ({server} then reads "N servers") — a multi-tenant process has
 * a single presence, so aggregate/first-server is the honest default.
 */
export interface PresenceConfig {
  enabled?: boolean;
  /** Show counts for this server only (default: aggregate of all). */
  server?: string;
  /** Display template, default "{online} online @ {server}". */
  format?: string;
  /**
   * Template shown when the pinned server is offline (or, without a
   * pinned server, when EVERY instance is down). Same placeholders as
   * `format`; default "⛔ {server} offline". The bot's status switches to
   * idle while down, so the member list reflects it at a glance.
   */
  downFormat?: string;
}

/** Death-coordinate recovery options for the deaths watcher. */
export interface DeathCoordsConfig {
  /**
   * DM the linked Discord account with death coordinates and a Chunkbase
   * link whenever a linked player dies. The in-game `!deathpos` command is
   * always available regardless of this flag.
   */
  dmLinked?: boolean;
}

/**
 * Rate-limit overrides for very active servers. Both limiters are
 * per-user token buckets; capacity is the burst size, the window is how
 * long a full refill takes. Defaults match the previous constants.
 */
export interface LimitsConfig {
  /** Slash commands per user per window (default 5 per 30s). */
  slashCapacity?: number;
  slashWindowMs?: number;
  /** Bridge messages per user per window (default 8 per 10s). */
  bridgeCapacity?: number;
  bridgeWindowMs?: number;
}

/** One server's scheduled restart. */
export interface ServerRestartSchedule {
  /** Wall-clock time "HH:MM" in the process TZ. */
  time: string;
  /** Weekday codes ("SU".."SA"); omitted = every day. */
  days?: string[];
  /** Countdown warnings in minutes before the restart (default 15,5,1). */
  warnMinutes?: number[];
}

/** Per-server schedule entries, keyed by server ID at the top level. */
export interface ServerScheduleConfig {
  restart?: ServerRestartSchedule;
}

/**
 * Web dashboard (separate process, `npm run start:web`). Off by default.
 * Secrets come from the environment, never from this file:
 * WEBUI_CLIENT_SECRET (Discord OAuth2) and WEBUI_SESSION_SECRET
 * (cookie signing).
 */
export interface WebUiConfig {
  enabled?: boolean;
  /** HTTP port (default 8130). */
  port?: number;
  /** Bind address (default 127.0.0.1 — put a reverse proxy in front). */
  host?: string;
  /**
   * Discord application client ID for the OAuth2 login. Falls back to
   * the bot's clientId when omitted (same application).
   */
  clientId?: string;
  /**
   * Public base URL of the dashboard (e.g. "https://panel.example.com")
   * used to build the OAuth2 redirect URI. Default: http://localhost:<port>.
   */
  publicUrl?: string;
}

/** Daily GitHub-release check. Enabled by default; opt out here. */
export interface UpdateNotifierConfig {
  /** Set false to skip the daily release check entirely. */
  enabled?: boolean;
  /**
   * DM operator-level admins (user-ID entries in the global adminUsers
   * list) once per newer release. Off by default — the log line alone is
   * the default behaviour.
   */
  dmAdmins?: boolean;
}

/** Community waypoint options. */
export interface WaypointsConfig {
  /**
   * Per-server cap on stored waypoints (default 100). Raise it once a
   * server actually hits the limit; the file and the in-game list grow
   * with it.
   */
  maxPerServer?: number;
}

/** Host resource monitoring (disk-full early warning). */
export interface HostAlertsConfig {
  /**
   * Alert (once, with hysteresis) when a monitored path's disk usage
   * reaches this percentage. Default 90; alerts go to each guild's
   * downtimeAlerts channel. Set to 0 to disable.
   */
  diskWarnPercent?: number;
  /**
   * Alert when the NEWEST backup of a server is older than this many
   * hours (stale backups are the failure nobody notices until it
   * matters). Off by default; alerts go to each guild's downtimeAlerts
   * channel and clear automatically when a fresh backup appears. Only
   * servers whose capability probe found the suite backup layout are
   * checked.
   */
  backupMaxAgeHours?: number;
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
  presence?: PresenceConfig;
  deathCoords?: DeathCoordsConfig;
  hostAlerts?: HostAlertsConfig;
  waypoints?: WaypointsConfig;
  limits?: LimitsConfig;
  updateNotifier?: UpdateNotifierConfig;
  /** Scheduled restarts (and future scheduled actions) per server. */
  schedules?: Record<string, ServerScheduleConfig>;
  /**
   * Milestone announcement thresholds per leaderboard stat key, in the
   * stat's NATIVE unit (playtime = ticks, distances = cm, counters =
   * counts). First activation seeds silently; see milestoneWatcher.
   */
  milestones?: Record<string, number[]>;
  /** Web dashboard settings (see WebUiConfig). */
  webui?: WebUiConfig;
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
  presence?: PresenceConfig;
  deathCoords?: DeathCoordsConfig;
  hostAlerts?: HostAlertsConfig;
  waypoints?: WaypointsConfig;
  limits?: LimitsConfig;
  updateNotifier?: UpdateNotifierConfig;
  schedules?: Record<string, ServerScheduleConfig>;
  milestones?: Record<string, number[]>;
  webui?: WebUiConfig;
}

/** Variables.txt key-value map */
export type VariablesMap = Record<string, string>;
