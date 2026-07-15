/**
 * Central type re-export hub.
 *
 * No types are defined here — every type lives in its domain file, grouped
 * the same way `utils/` is. Always import from this file, never from a
 * sub-module directly; the grouping is free to change, this path is not.
 *
 *   minecraft/  the world and its players — whitelist, coords, TPS, stats
 *               files, leaderboards, mods, backups
 *   server/     the instance and how we reach it — capabilities, RCON,
 *               uptime, the log watcher interface
 *   stores/     shapes of persisted state — links, rewards and streaks,
 *               scheduler and downtime state
 *   discord/    Discord-facing shapes — managed channels, embed options
 *   commands.ts the command system itself, used by both the slash and
 *               in-game surfaces
 *
 * Config and stat contracts are not here: they live in `@mcbot/schema`,
 * because the dashboard and its browser bundle need them too.
 *
 * (This header used to list every file, and had drifted — it still named
 * config.ts and stats.ts long after both moved to @mcbot/schema, and never
 * learned about capabilities.ts. Five group names go stale more slowly
 * than fifteen filenames, and the directory listing is now the index.)
 */

export type {
  RawServerConfig,
  ServerConfig,
  GuildNotificationConfig,
  GuildChatBridgeConfig,
  GuildLeaderboardConfig,
  GuildStatusEmbedConfig,
  GuildDowntimeAlertsConfig,
  GuildTpsAlertsConfig,
  GuildChannelPurgeConfig,
  GuildConsoleConfig,
  GuildReportsConfig,
  GuildConfig,
  CommandOverrideConfig,
  PresenceConfig,
  DeathCoordsConfig,
  HostAlertsConfig,
  WaypointsConfig,
  LimitsConfig,
  UpdateNotifierConfig,
  ServerRestartSchedule,
  ServerScheduleConfig,
  RawBotConfig,
  BotConfig,
  VariablesMap,
} from "@mcbot/schema/config.js";

export type {
  BotCommand,
  BotClient,
  InGameCommandDefinition,
  InGameCommandInfo,
  InGameCommandResult,
} from "./commands.js";

export type {
  WhitelistEntry,
  PlayerCoords,
  PlayerCount,
  ServerListResult,
  PaperTpsResult,
  VanillaTpsResult,
  MinimalTpsResult,
  TpsResult,
  MojangProfile,
  MinecraftStatsFile,
  WhitelistAuditEntry,
  WhitelistAuditMap,
} from "./minecraft/minecraft.js";

export type {
  FlattenedStat,
  ScoredStat,
  LeaderboardStatDefinition,
  LeaderboardEntry,
  LeaderboardInterval,
  SnapshotData,
} from "@mcbot/schema/stats.js";

export type {
  LinkCode,
  LinkedAccountsMap,
  LinkCodesMap,
} from "./stores/link.js";

export type {
  DailyRewardItem,
  DailyRewardsConfig,
  UserClaimData,
  StreakData,
  NextBonusStreak,
} from "./stores/rewards.js";

export type {
  LogHandler,
  LogWatcherEntry,
  ILogWatcher,
} from "./server/logWatcher.js";

export type {
  EmbedOptions,
  EmbedWithThumbnailOptions,
  EmbedStyleOptions,
} from "./discord/embed.js";

export type {
  RconPacket,
  PendingRconCommand,
} from "./server/rcon.js";

export type {
  LeaderboardScheduleState,
  StatusChannelState,
  StatusMessageState,
  DowntimeState,
  JsonCacheEntry,
} from "./stores/scheduler.js";

export type {
  BackupDirInfo,
  BackupSummary,
  ScriptResult,
} from "./minecraft/backup.js";

export type {
  ServerCapabilities,
  ScriptCapabilities,
} from "./server/capabilities.js";
export { allCapabilities } from "./server/capabilities.js";

export type {
  ManagedCategory,
  EnsuredTextChannel,
  EnsuredVoiceChannel,
} from "./discord/discord.js";

export type {
  ModSide,
  ModInfo,
  ModList,
} from "./minecraft/mods.js";

export type { UptimeStats } from "./server/uptime.js";

export type {
  BuildLeaderboardOptions,
  LeaderboardData,
} from "./minecraft/leaderboard.js";
