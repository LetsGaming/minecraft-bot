/**
 * Central type re-export hub for the Minecraft Discord bot.
 *
 * No types are defined here — every type lives in its domain file.
 * Always import from this file, never from a sub-module directly.
 *
 * Domain files:
 *   config.ts      — server/guild/bot config shapes
 *   commands.ts    — BotCommand, BotClient, in-game command system
 *   minecraft.ts   — whitelist, coords, TPS, stats file, Mojang API
 *   stats.ts       — flattened stats, leaderboard definitions, snapshots
 *   link.ts        — Discord↔Minecraft account linking
 *   rewards.ts     — daily rewards, streaks
 *   logWatcher.ts  — LogHandler, LogWatcherEntry, ILogWatcher
 *   embed.ts       — EmbedOptions and variants
 *   rcon.ts        — RCON packet/command types
 *   scheduler.ts   — scheduler state, downtime state, JSON cache
 *   backup.ts      — BackupDirInfo, BackupSummary, ScriptResult
 *   discord.ts     — managed channel helpers (ManagedCategory etc.)
 *   mods.ts        — ModSide, ModInfo, ModList
 *   uptime.ts      — UptimeStats
 *   leaderboard.ts — BuildLeaderboardOptions, LeaderboardData
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
  GuildConfig,
  CommandOverrideConfig,
  RawBotConfig,
  BotConfig,
  VariablesMap,
} from "./config.js";

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
} from "./minecraft.js";

export type {
  FlattenedStat,
  ScoredStat,
  LeaderboardStatDefinition,
  LeaderboardEntry,
  LeaderboardInterval,
  SnapshotData,
} from "./stats.js";

export type {
  LinkCode,
  LinkedAccountsMap,
  LinkCodesMap,
} from "./link.js";

export type {
  DailyRewardItem,
  DailyRewardsConfig,
  UserClaimData,
  StreakData,
  NextBonusStreak,
} from "./rewards.js";

export type {
  LogHandler,
  LogWatcherEntry,
  ILogWatcher,
} from "./logWatcher.js";

export type {
  EmbedOptions,
  EmbedWithThumbnailOptions,
  EmbedStyleOptions,
} from "./embed.js";

export type {
  RconPacket,
  PendingRconCommand,
} from "./rcon.js";

export type {
  LeaderboardScheduleState,
  StatusChannelState,
  StatusMessageState,
  DowntimeState,
  JsonCacheEntry,
} from "./scheduler.js";

export type {
  BackupDirInfo,
  BackupSummary,
  ScriptResult,
} from "./backup.js";

export type {
  ManagedCategory,
  EnsuredTextChannel,
  EnsuredVoiceChannel,
} from "./discord.js";

export type {
  ModSide,
  ModInfo,
  ModList,
} from "./mods.js";

export type { UptimeStats } from "./uptime.js";

export type {
  BuildLeaderboardOptions,
  LeaderboardData,
} from "./leaderboard.js";
