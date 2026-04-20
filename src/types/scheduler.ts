// ── Scheduler & status state types ───────────────────────────────────────────

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

export interface DowntimeState {
  consecutiveFailures: number;
  alerted: boolean;
  suppressUntil: number;
  lastKnownState: "online" | "offline" | null;
}

export interface JsonCacheEntry {
  mtimeMs: number;
  data: unknown;
}
