/**
 * Who the server knows: the whitelist, plus usercache as the fallback
 * name source.
 *
 * Split out of the old `utils.ts` grab-bag: this is Minecraft domain,
 * not a generic helper. Reads route through serverAccess so remote
 * instances fetch from the API wrapper transparently.
 *
 * Both files are cached per server ID (multi-instance setups must not
 * bleed into each other) through the shared `cached()` helper, which also
 * collapses concurrent misses into one read and refuses to store a read that
 * began before an invalidation. Entries expire after WHITELIST_CACHE_TTL_MS as
 * a safety net for edits made outside the bot (in-game `/whitelist add`,
 * manual file edits). Bot-initiated edits additionally call
 * invalidateWhitelistCache() for immediate consistency.
 */
import type { ServerInstance } from "../server/server.js";
import * as serverAccess from "../server/serverAccess.js";
import type { WhitelistEntry } from "../../types/index.js";
import { cached, invalidate, invalidatePrefix } from "../cache.js";
import { MS } from "@mcbot/schema/time.js";

const WHITELIST_CACHE_TTL_MS = MS.minute;

const WHITELIST_KEY_PREFIX = "whitelist:";
// usercache.json covers every player the server has ever seen, so name
// resolution keeps working on servers that run without a whitelist.
const USERCACHE_KEY_PREFIX = "usercache:";

/** Load the whitelist for the given server; null when it is empty. */
export async function loadWhitelist(
  forceReload = false,
  server: ServerInstance,
): Promise<WhitelistEntry[] | null> {
  const cfg = server.config;
  const key = `${WHITELIST_KEY_PREFIX}${cfg.id}`;
  if (forceReload) invalidate(key);
  return cached(key, WHITELIST_CACHE_TTL_MS, async () => {
    const data = await serverAccess.readWhitelist(cfg);
    return data.length > 0 ? data : null;
  });
}

export function invalidateWhitelistCache(serverId?: string): void {
  if (serverId) {
    invalidate(`${WHITELIST_KEY_PREFIX}${serverId}`);
    invalidate(`${USERCACHE_KEY_PREFIX}${serverId}`);
  } else {
    invalidatePrefix(WHITELIST_KEY_PREFIX);
    invalidatePrefix(USERCACHE_KEY_PREFIX);
  }
}

function loadUserCache(server: ServerInstance): Promise<WhitelistEntry[]> {
  return cached(`${USERCACHE_KEY_PREFIX}${server.config.id}`, WHITELIST_CACHE_TTL_MS, () =>
    serverAccess.readUserCache(server.config),
  );
}

/**
 * Every player the bot can put a name to: the whitelist plus usercache.json.
 *
 * Whitelist entries come first and win name conflicts (they are the
 * admin-managed canonical list); usercache fills in everyone else, most
 * recently seen first. On servers without a whitelist this is simply the
 * usercache, so stats, leaderboards, and autocomplete keep working.
 */
export async function loadKnownPlayers(
  server: ServerInstance,
): Promise<WhitelistEntry[]> {
  const [whitelist, usercache] = await Promise.all([
    loadWhitelist(false, server),
    loadUserCache(server),
  ]);

  const known: WhitelistEntry[] = [...(whitelist ?? [])];
  const seen = new Set(known.map((p) => p.uuid));

  // usercache.json appends as players join, so iterate newest first.
  for (let i = usercache.length - 1; i >= 0; i--) {
    const entry = usercache[i]!;
    if (seen.has(entry.uuid)) continue;
    seen.add(entry.uuid);
    known.push(entry);
  }

  return known;
}

/** Drop both cached files for this server, then load them fresh. */
export function reloadKnownPlayers(server: ServerInstance): Promise<WhitelistEntry[]> {
  invalidateWhitelistCache(server.config.id);
  return loadKnownPlayers(server);
}
