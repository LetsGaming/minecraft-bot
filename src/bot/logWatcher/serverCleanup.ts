import { log } from "@mcbot/core/utils/logger.js";

type ServerCleanup = (serverId: string) => void;

const cleanups = new Set<ServerCleanup>();

/** Register a callback that drops a module's per-server state when a server is removed. */
export function onServerRemoved(cleanup: ServerCleanup): void {
  cleanups.add(cleanup);
}

/** Run every registered cleanup for a server; a failing one never blocks the rest. */
export function forgetServer(serverId: string): void {
  for (const cleanup of cleanups) {
    try {
      cleanup(serverId);
    } catch (err) {
      log.warn("server", `State cleanup failed for ${serverId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
