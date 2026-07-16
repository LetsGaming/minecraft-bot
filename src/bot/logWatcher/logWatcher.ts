/**
 * The in-game command registry.
 *
 * `defineCommand` registers a regex here at import time; each server's
 * watcher reads the list when a log line arrives, so a command is declared
 * once and every instance dispatches it.
 *
 * This file also held a `LogWatcher` class that tailed the server's
 * latest.log with fs.watch and a 1s polling fallback. It only ever worked
 * when the bot shared a filesystem with the server, and it was a second
 * implementation of the wrapper's `logStream.ts` — down to the same
 * 1 MB-per-cycle catch-up cap, whose comments in each file pointed at the
 * other to explain itself. Since 5.0.0 every instance is watched through
 * `RemoteLogWatcher` over the wrapper's SSE stream, and the tailing lives
 * only where the log does.
 */
import type {
  LogHandler,
  LogWatcherEntry,
  ILogWatcher,
} from "@mcbot/core/types/index.js";

export type { ILogWatcher };

const _globalWatchers: LogWatcherEntry[] = [];

export function registerLogCommand(regex: RegExp, handler: LogHandler): void {
  _globalWatchers.push({ regex, handler });
}

export function getGlobalWatchers(): LogWatcherEntry[] {
  return _globalWatchers;
}
