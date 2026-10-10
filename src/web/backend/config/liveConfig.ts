import { watchConfig, loadConfig, type WatchConfigOptions } from "@mcbot/core/config.js";
import {
  addServerInstance,
  getAllInstances,
  removeServerInstance,
} from "@mcbot/core/utils/server/server.js";
import { log } from "@mcbot/core/utils/logger.js";
import { invalidateWhere } from "@mcbot/core/utils/cache.js";
import { forget } from "@mcbot/core/utils/wrapper/lastKnown.js";
import { sessionHolds } from "../auth/capabilities.js";
import { closeRevokedStreams, closeStreamsForServer } from "../console/streamRegistry.js";
import type { BotConfig } from "@mcbot/core/types/index.js";

export interface WebReconcileResult {
  added: string[];
  removed: string[];
  replaced: string[];
}

/**
 * Forget everything the web backend cached for a server id, so a server later
 * re-added under the same id cannot be answered from the old one's data.
 * Cache keys embed the id as a colon-separated segment.
 */
function dropServerCaches(serverId: string): void {
  forget(serverId);
  invalidateWhere((key) => key.split(":").includes(serverId));
}

/** Close open console streams whose session no longer holds server:read. */
export function revalidateOpenStreams(): number {
  return closeRevokedStreams((session, serverId) =>
    sessionHolds(session, "server:read", serverId),
  );
}

/**
 * Bring the dashboard's server registry in line with a freshly loaded config.
 *
 * Unlike the bot, the dashboard holds no per-server watchers, so an instance
 * whose connection settings changed can simply be rebuilt and picks the new
 * apiUrl/apiKey up on its next call.
 */
export function reconcileWebServers(fresh: BotConfig): WebReconcileResult {
  const configured = fresh.servers;
  const registered = getAllInstances();
  const registeredIds = new Set(registered.map((i) => i.id));

  const removed = [...registeredIds].filter((id) => !(id in configured));
  const added = Object.keys(configured).filter((id) => !registeredIds.has(id));
  const replaced = registered
    .filter(
      (inst) =>
        inst.id in configured &&
        JSON.stringify(inst.config) !== JSON.stringify(configured[inst.id]),
    )
    .map((inst) => inst.id);

  for (const id of removed) {
    closeStreamsForServer(id, "removed");
    removeServerInstance(id);
    dropServerCaches(id);
  }
  for (const id of replaced) {
    closeStreamsForServer(id, "reconfigured");
    dropServerCaches(id);
  }
  for (const id of [...added, ...replaced]) addServerInstance(configured[id]!);
  return { added, removed, replaced };
}

/** Settings read once at listen time; a change needs a dashboard restart. */
function bindSettings(cfg: BotConfig): string {
  return JSON.stringify([cfg.webui?.port, cfg.webui?.host]);
}

/**
 * Keep the dashboard process on the live config.json: `loadConfig()` caches
 * for the process lifetime, so without this grants, adminUsers, the console
 * block list and the server list would only change on restart.
 */
export function startLiveConfig(options?: WatchConfigOptions): void {
  let previous = loadConfig();
  watchConfig((fresh) => {
    const result = reconcileWebServers(fresh);
    const revoked = revalidateOpenStreams();
    if (revoked > 0) log.info("web", `Closed ${revoked} console stream(s) after access changed.`);
    if (result.added.length + result.removed.length + result.replaced.length > 0) {
      log.info(
        "web",
        `Config reloaded; servers added [${result.added.join(", ")}], removed [${result.removed.join(", ")}], reconnected [${result.replaced.join(", ")}]`,
      );
    }
    if (bindSettings(previous) !== bindSettings(fresh)) {
      log.warn(
        "web",
        "webui.port/host changed; restart the dashboard to bind the new address.",
      );
    }
    previous = fresh;
  }, options);
}
