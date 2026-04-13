/**
 * Central type definitions for the Minecraft Discord bot.
 * Every data structure that crosses module boundaries is defined here.
 */

import type {
  ChatInputCommandInteraction,
  Client,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';

// ── Config ──

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

// ── Discord commands ──

export interface BotCommand {
  data: SlashCommandBuilder | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'> | SlashCommandSubcommandsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

/**
 * Extended Discord.js Client with a commands collection.
 * discord.js does not ship a typed `commands` property,
 * so we extend the base Client with our own.
 */
export interface BotClient extends Client {
  commands: Map<string, BotCommand>;
}

// ── Minecraft data ──

export interface WhitelistEntry {
  uuid: string;
  name: string;
}

export interface PlayerCoords {
  x: number;
  y: number;
  z: number;
}

export interface PlayerCount {
  playerCount: string;
  maxPlayers: string;
}

export interface ServerListResult {
  playerCount: string;
  maxPlayers: string;
  players: string[];
}

/** TPS result from a Paper/Spigot server with 1m/5m/15m averages */
export interface PaperTpsResult {
  tps1m: number;
  tps5m: number;
  tps15m: number;
  raw: string;
}

/** TPS result derived from vanilla `tick query` command */
export interface VanillaTpsResult {
  tps1m: number;
  mspt: number;
  raw: string;
  p50?: number;
  p95?: number;
  p99?: number;
}

/** Minimal TPS result when only the base TPS value is parseable */
export interface MinimalTpsResult {
  tps1m: number;
  raw: string;
}

export type TpsResult = PaperTpsResult | VanillaTpsResult | MinimalTpsResult;

// ── Stats ──

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

export type LeaderboardInterval = 'daily' | 'weekly' | 'monthly';

/**
 * Minecraft stats file — can be either the old flat format
 * (dot-separated keys) or the new nested format (category -> key -> value).
 */
export interface MinecraftStatsFile {
  stats?: Record<string, Record<string, number>>;
  [key: string]: unknown;
}

export interface SnapshotData {
  timestamp: number;
  players: Record<string, Record<string, number>>;
}

// ── Link system ──

export interface LinkCode {
  discordId: string;
  expires: number;
  confirmed: boolean;
}

export type LinkedAccountsMap = Record<string, string>;
export type LinkCodesMap = Record<string, LinkCode>;

// ── Daily rewards ──

export interface DailyRewardItem {
  item: string;
  amount: number;
  weight?: number;
}

export interface DailyRewardsConfig {
  default: DailyRewardItem[];
  streakBonuses?: Record<string, DailyRewardItem>;
}

export interface UserClaimData {
  lastClaim: number;
  currentStreak: number;
  bonusStreak: number;
  longestStreak: number;
  rewards: Array<{
    date: number;
    reward: DailyRewardItem;
    bonus: DailyRewardItem | null;
  }>;
}

// ── Whitelist audit ──

export interface WhitelistAuditEntry {
  username?: string;
  uuid?: string | null;
  addedBy?: string;
  addedById?: string;
  addedAt?: string;
  server?: string;
  removedBy?: string;
  removedById?: string;
  removedAt?: string;
  removedFromServer?: string;
}

export type WhitelistAuditMap = Record<string, WhitelistAuditEntry>;

// ── Log watcher ──

export type LogHandler = (
  match: RegExpExecArray,
  client: Client,
  server: import('../utils/server.js').ServerInstance,
) => Promise<void>;

export interface LogWatcherEntry {
  regex: RegExp;
  handler: LogHandler;
}

// ── In-game command system ──

export interface InGameCommandDefinition {
  name: string;
  aliases?: string[];
  description: string;
  args?: string[];
  cooldown?: number;
  handler: (
    username: string,
    args: Record<string, string>,
    client: Client,
    server: import('../utils/server.js').ServerInstance,
  ) => Promise<void>;
}

export interface InGameCommandInfo {
  command: string;
  description: string;
}

export interface InGameCommandResult {
  init: () => void;
  COMMAND_INFO: InGameCommandInfo;
}

// ── Mojang API ──

export interface MojangProfile {
  id: string;
  name: string;
}

// ── RCON protocol ──

export interface RconPacket {
  id: number;
  type: number;
  body: string;
  totalSize: number;
}

export interface PendingRconCommand {
  resolve: (body: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── Embed utilities ──

export interface EmbedOptions {
  title: string;
  description?: string;
  color?: number;
  footer?: { text: string; iconURL?: string };
  timestamp?: Date | string | number | boolean;
}

export interface EmbedWithThumbnailOptions extends EmbedOptions {
  thumbnail?: string;
}

export interface EmbedStyleOptions {
  footer?: { text: string; iconURL?: string };
  timestamp?: Date | number | boolean;
}

// ── JSON cache ──

export interface JsonCacheEntry {
  mtimeMs: number;
  data: unknown;
}

// ── Scheduler ──

export interface LeaderboardScheduleState {
  [guildId: string]: number;
}

/**
 * Persisted IDs for channels the bot has created per guild.
 * Stored so the bot can find its own channels after a restart without
 * needing to re-create them.
 */
export interface StatusChannelState {
  /** ID of the bot-managed category */
  categoryId: string;
  /** Text channel used for the status embed */
  textChannelId: string;
  /** Message ID of the pinned status embed inside the text channel */
  messageId: string;
  /** Voice channel used as a read-only player-count display */
  voiceChannelId: string;
}

export interface StatusMessageState {
  [guildId: string]: StatusChannelState | undefined;
}

// ── Downtime monitor ──

export interface DowntimeState {
  consecutiveFailures: number;
  alerted: boolean;
  suppressUntil: number;
  lastKnownState: 'online' | 'offline' | null;
}

// ── Variables.txt parsing ──

export type VariablesMap = Record<string, string>;

// ── Streak info ──

export interface StreakData {
  currentStreak: number;
  longestStreak: number;
  bonusStreak: number;
}

export interface NextBonusStreak {
  streak: number;
  reward: DailyRewardItem;
}
