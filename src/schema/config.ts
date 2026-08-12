// ── Config types ──────────────────────────────────────────────────────────────

import type { LeaderboardInterval } from "./stats.js";
import type { NotificationEvent } from "./notifications.js";
import type { CapabilityGrants } from "./capabilities.js";

/**
 * The fields that configured local mode, removed in 5.0.0.
 *
 * Named here so validation can recognise a 4.x config and say what to do
 * with it, instead of reporting a bare "apiUrl is required" at someone who
 * has a perfectly good config for the previous major. Every one of these
 * describes the machine the server runs on, and now belongs in the API
 * wrapper's own config — which lives on that machine.
 */
export const REMOVED_LOCAL_SERVER_FIELDS = [
  "serverDir",
  "scriptDir",
  "linuxUser",
  "screenSession",
  "useRcon",
  "rconHost",
  "rconPort",
  "rconPassword",
] as const;

export interface RawServerConfig {
  id?: string;
  /**
   * Base URL of the API wrapper on the Minecraft host. **Required** since
   * 5.0.0: every filesystem, shell and RCON operation for this instance
   * goes through it. Example: "http://192.168.1.10:3030" (trusted LAN) or
   * "https://mc-api.example.com" (anything beyond the LAN).
   *
   * Plaintext http:// is only accepted for loopback/private/LAN hosts —
   * the x-api-key and all commands travel unencrypted. Public hosts
   * require https:// (or an explicit allowInsecureHttp override).
   */
  apiUrl?: string;
  /** Shared secret sent as x-api-key to the API wrapper. **Required**. */
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
  /**
   * Host to send a direct Minecraft server-list ping to, when the API wrapper
   * cannot be reached. Defaults to the hostname in `apiUrl` — the wrapper
   * runs on the Minecraft host, so that is already the right machine. Set
   * this only when the game server answers on a different address than the
   * wrapper (a proxy, or a split deployment).
   */
  pingHost?: string;
  /**
   * Port for that ping. Defaults to whatever the wrapper last reported as the
   * server's `server-port`, and to 25565 before it has ever answered.
   */
  pingPort?: number;
  /**
   * Turn the direct ping off entirely.
   *
   * The ping is what lets the bot still report "online, 4 players" while the
   * wrapper is down, so switching it off means going back to "state unknown"
   * for that case. Only worth it if the game port is firewalled off from the
   * bot, or the server runs with `enable-status=false`.
   */
  disableDirectPing?: boolean;
  /**
   * The address players type into the Minecraft client, e.g. "mc.example.com"
   * or "play.example.com:25566".
   *
   * Deliberately separate from `apiUrl` and `pingHost`: those are how the
   * *bot* reaches the host, and on a normal deployment they are a LAN IP or
   * an internal DNS name that nobody outside can connect to. Publishing
   * either as the join address is how a member ends up trying to connect to
   * 192.168.1.10. Unset means `/info` says the address is not published
   * rather than guessing one.
   */
  publicAddress?: string;
  /**
   * The modpack players need, when this server runs one.
   *
   * `url` should point at whatever a member can actually install from
   * (Modrinth, CurseForge, a launcher share link). Without this, the answer
   * to "what do I need to join" is a mod list a person has to assemble by
   * hand, which is why it was being answered by a human in chat every time.
   */
  modpack?: {
    name: string;
    version?: string;
    url?: string;
  };
  commands?: Record<string, CommandOverrideConfig>;
}

/**
 * A resolved instance.
 *
 * Since 5.0.0 this carries no host knowledge at all: no paths, no user, no
 * screen session, no RCON credentials. The bot reaches every server through
 * an API wrapper, and those fields describe the wrapper's machine, not the
 * bot's view of it. Keeping them here meant two implementations of one
 * contract and two places to fix every host-shaped bug.
 */
export interface ServerConfig {
  id: string;
  apiUrl: string;
  apiKey: string;
  allowInsecureHttp?: boolean;
  /** See RawServerConfig — the direct-ping fallback when the wrapper is down. */
  pingHost?: string;
  pingPort?: number;
  disableDirectPing?: boolean;
  /**
   * The address players type into the Minecraft client, e.g. "mc.example.com"
   * or "play.example.com:25566".
   *
   * Deliberately separate from `apiUrl` and `pingHost`: those are how the
   * *bot* reaches the host, and on a normal deployment they are a LAN IP or
   * an internal DNS name that nobody outside can connect to. Publishing
   * either as the join address is how a member ends up trying to connect to
   * 192.168.1.10. Unset means `/info` says the address is not published
   * rather than guessing one.
   */
  publicAddress?: string;
  /**
   * The modpack players need, when this server runs one.
   *
   * `url` should point at whatever a member can actually install from
   * (Modrinth, CurseForge, a launcher share link). Without this, the answer
   * to "what do I need to join" is a mod list a person has to assemble by
   * hand, which is why it was being answered by a human in chat every time.
   */
  modpack?: {
    name: string;
    version?: string;
    url?: string;
  };
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
  /**
   * Which events to post. Omit to receive the default set (the dispatcher
   * treats an absent list as DEFAULT_NOTIFICATION_EVENTS); an explicit empty
   * list receives nothing.
   */
  events?: NotificationEvent[];
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
   * IANA timezone for THIS guild's wall-clock features — the nightly
   * channel purge, "busiest hour" in /activity, and anything else that
   * has to pick one local midnight. Falls back to the global `timezone`,
   * then UTC.
   *
   * Timestamps in embeds do not need this: those are sent as Discord
   * `<t:…>` markers and render in each reader's own zone.
   *
   * Example: "Europe/Berlin".
   */
  timezone?: string;
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
  /**
   * Arbitrary per-command settings (see COMMAND_OPTIONS for which commands
   * expose what, and the dashboard's Commands tab for editing them). Stored
   * as simple scalars, e.g. `{ url: "https://map.example.com" }` for /map.
   */
  options?: Record<string, string | number | boolean>;
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
  /**
   * Slash commands per user per window (default 5 per 30s).
   * @minimum 1
   */
  slashCapacity?: number;
  /** @minimum 1000 */
  slashWindowMs?: number;
  /**
   * Bridge messages per user per window (default 8 per 10s).
   * @minimum 1
   */
  bridgeCapacity?: number;
  /** @minimum 1000 */
  bridgeWindowMs?: number;
}

/** One server's scheduled restart. */
export interface ServerRestartSchedule {
  /** Wall-clock time "HH:MM" in the process TZ. */
  time: string;
  /** Weekday codes ("SU".."SA"); omitted = every day. */
  days?: string[];
  /**
   * Countdown warnings in minutes before the restart (default 15,5,1).
   * @items.exclusiveMinimum 0
   */
  warnMinutes?: number[];
}

/** Per-server schedule entries, keyed by server ID at the top level. */
/**
 * In-game nudges that tell players `/link` and `/daily` exist.
 *
 * On by default: the features are useless to a player who never hears
 * about them, and the limits below are what keep it from becoming spam.
 */
export interface FeatureNudgeConfig {
  /** Default true. */
  enabled?: boolean;
  /**
   * Give up after this many mentions of one feature to one player.
   * Someone told three times has decided. Default 3.
   * @minimum 1
   */
  maxPerFeature?: number;
  /**
   * Minimum gap between two mentions of the same feature to the same
   * player. Default 48.
   * @minimum 1
   */
  cooldownHours?: number;
}

export interface ServerScheduleConfig {
  restart?: ServerRestartSchedule;
  /**
   * IANA timezone the times in this block are written in.
   *
   * Server-scoped rather than guild-scoped on purpose: a 04:00 restart
   * belongs to the machine's operator, and when two guilds watch one
   * server there is no guild answer to give. Falls back to the global
   * `timezone`, then UTC.
   */
  timezone?: string;
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
  /**
   * Host-side capability grants: Discord user ID → server id (or "*") →
   * capabilities. Lets an operator delegate part of the host API without
   * handing over `adminUsers`, which is all of it.
   *
   * ```jsonc
   * "grants": {
   *   "123456789012345678": { "survival": ["config:read", "config:write"] }
   * }
   * ```
   *
   * A user in the top-level `adminUsers` holds every capability already and
   * needs no entry here. `bot:config` is not grantable: editing this file is
   * sysadmin-only, which is also what stops a grantee escalating themselves.
   * See schema/capabilities.ts.
   */
  grants?: CapabilityGrants;
  /** Live console settings (see WebUiConsoleConfig). */
  console?: WebUiConsoleConfig;
}

/** The dashboard's live console (DSH-01/DSH-02). */
export interface WebUiConsoleConfig {
  /**
   * Commands refused by the console, matched on the first word after any
   * leading slashes, case-insensitively — so one entry covers `stop`, `/stop`
   * and `STOP`.
   *
   * Omit the key to use the defaults (`stop`, `op`, `deop`). An explicit empty
   * array is not "use defaults", it is "block nothing": the console then
   * accepts anything RCON does, which is a deliberate choice an operator can
   * make and should have to make on purpose.
   */
  blockedCommands?: string[];
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
  /**
   * @minimum 0
   * @maximum 100
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
  /** @minimum 0 */
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
  /**
   * Default IANA timezone for wall-clock features, used when a guild or a
   * schedule does not set its own. Default UTC — the zone everything is
   * stored in, so an unconfigured deployment is coherent rather than
   * dependent on the container's clock.
   *
   * This replaces the TZ environment variable, which forced one zone on
   * the whole process: a bot serving guilds in Berlin and Denver purged
   * both at Berlin midnight.
   */
  timezone?: string;
  commands?: Record<string, CommandOverrideConfig>;
  leaderboard?: Record<string, unknown>;
  /**
   * TPS below this triggers an alert (default 15).
   * @exclusiveMinimum 0
   */
  tpsWarningThreshold?: number;
  /** @minimum 1000 */
  tpsPollIntervalMs?: number;
  leaderboardInterval?: LeaderboardInterval;
  presence?: PresenceConfig;
  deathCoords?: DeathCoordsConfig;
  hostAlerts?: HostAlertsConfig;
  waypoints?: WaypointsConfig;
  limits?: LimitsConfig;
  updateNotifier?: UpdateNotifierConfig;
  /** Scheduled restarts (and future scheduled actions) per server. */
  /** In-game discoverability nudges (see FeatureNudgeConfig). */
  featureNudges?: FeatureNudgeConfig;
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
  /** In-game discoverability nudges (see FeatureNudgeConfig). */
  featureNudges?: FeatureNudgeConfig;
  schedules?: Record<string, ServerScheduleConfig>;
  milestones?: Record<string, number[]>;
  webui?: WebUiConfig;
  /** Default IANA timezone for wall-clock features. Default UTC. */
  timezone?: string;
}

/** Variables.txt key-value map */
export type VariablesMap = Record<string, string>;
