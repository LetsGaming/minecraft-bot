// ── Log watcher types ─────────────────────────────────────────────────────────

import type { Client } from "discord.js";
import type { ServerInstance } from "../utils/server.js";

export type LogHandler = (
  match: RegExpExecArray,
  client: Client,
  server: ServerInstance,
) => Promise<void>;

export interface LogWatcherEntry {
  regex: RegExp;
  handler: LogHandler;
}

/**
 * Minimal interface that both LogWatcher (local) and RemoteLogWatcher (SSE)
 * satisfy. Watchers register against this interface so they work with both.
 */
export interface ILogWatcher {
  readonly server: ServerInstance;
  register(regex: RegExp, handler: LogHandler): void;
  start(client: Client): Promise<void>;
  stop(): void;
}
