import type { ServerState } from "@mcbot/schema/serverState.js";

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
  /** Consecutive checks that found the server process stopped. */
  consecutiveFailures: number;
  /** A "server down" alert is currently outstanding. */
  alerted: boolean;
  /**
   * Consecutive checks where the API wrapper itself did not answer. Tracked
   * apart from `consecutiveFailures` because it is a different incident with
   * a different fix — and because counting it as downtime is what made a
   * wrapper restart look like a server crash.
   */
  consecutiveUnreachable: number;
  /** An "API wrapper unreachable" alert is currently outstanding. */
  wrapperAlerted: boolean;
  suppressUntil: number;
  lastKnownState: ServerState | null;
}

export interface JsonCacheEntry {
  mtimeMs: number;
  data: unknown;
}
