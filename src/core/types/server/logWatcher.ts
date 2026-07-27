// ── Log watcher types ─────────────────────────────────────────────────────────

import type { Client } from "discord.js";
import type { ServerInstance } from "../../utils/server/server.js";

/**
 * A log-line handler. May be synchronous.
 *
 * Returning void is not a shortcut — it is how a handler says "I have taken
 * ownership of this line and the dispatcher should not wait for me". The chat
 * bridge does exactly that: it queues the Discord send per channel and
 * returns, because handlers are dispatched one at a time and awaiting a
 * network round-trip in one of them stalls every other watcher for the same
 * server. A handler that returns a promise is still awaited, so ordering
 * guarantees are unchanged for the ones that need them.
 */
export type LogHandler = (
  match: RegExpExecArray,
  client: Client,
  server: ServerInstance,
) => void | Promise<void>;

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
