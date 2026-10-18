/**
 * The cache entries that belong to a server's config files and mods, with
 * their keys built in one place. Each resource lives in two caches: the TTL
 * cache (freshness) and the last-known store (stale fallback during an
 * outage). A write has to drop both, or the next read can serve what the
 * write superseded.
 */
import { forget } from "@mcbot/core/utils/wrapper/lastKnown.js";
import { invalidate } from "@mcbot/core/utils/cache.js";

export const lastKnownKey = {
  configIndex: "configIndex",
  configFile: (fileId: string): string => `configFile:${fileId}`,
  modsInstalled: "modsInstalled",
} as const;

export const ttlKey = {
  configIndex: (serverId: string): string => `configIndex:${serverId}`,
  configFile: (serverId: string, fileId: string): string => `configFile:${serverId}:${fileId}`,
  modsInstalled: (serverId: string): string => `mods:installed:${serverId}`,
  modsUpdates: (serverId: string): string => `mods:updates:${serverId}`,
} as const;

/** Drop one config file and the listing it appears in. */
export function bustConfigFile(serverId: string, fileId: string): void {
  forget(serverId, lastKnownKey.configFile(fileId));
  forget(serverId, lastKnownKey.configIndex);
  invalidate(ttlKey.configFile(serverId, fileId));
  invalidate(ttlKey.configIndex(serverId));
}

/** Drop the installed list and the update check after a mod mutation. */
export function bustMods(serverId: string): void {
  forget(serverId, lastKnownKey.modsInstalled);
  invalidate(ttlKey.modsInstalled(serverId));
  invalidate(ttlKey.modsUpdates(serverId));
}
