/**
 * Who the server knows: the whitelist, plus usercache as the fallback
 * name source.
 *
 * Split out of the old `utils.ts` grab-bag — this is Minecraft domain,
 * not a generic helper. Reads route through serverAccess so remote
 * instances fetch from the API wrapper transparently.
 *
 * Both files are cached per server ID (multi-instance setups must not
 * bleed into each other) and expire after WHITELIST_CACHE_TTL_MS as a
 * safety net for edits made outside the bot (in-game `/whitelist add`,
 * manual file edits). Bot-initiated edits additionally call
 * invalidateWhitelistCache() for immediate consistency.
 */
import type { ServerInstance } from "../server/server.js";
import * as serverAccess from "../server/serverAccess.js";
import type { WhitelistEntry } from "../../types/index.js";

const WHITELIST_CACHE_TTL_MS = 60_000;

const whitelistCache = new Map<
  string,
  { data: WhitelistEntry[] | null; at: number }
>();

// usercache.json covers every player the server has ever seen, so name
// resolution keeps working on servers that run without a whitelist.
const userCacheCache = new Map<string, { data: WhitelistEntry[]; at: number }>();

/** Load the whitelist for the given server. */
export async function loadWhitelist(
  forceReload = false,
  server: ServerInstance,
): Promise<WhitelistEntry[] | null> {
  const cfg = server.config;
  const key = cfg.id;

  const cached = whitelistCache.get(key);
  if (!forceReload && cached && Date.now() - cached.at < WHITELIST_CACHE_TTL_MS)
    return cached.data;

  const data = await serverAccess.readWhitelist(cfg);
  const result = data.length > 0 ? data : null;
  whitelistCache.set(key, { data: result, at: Date.now() });
  return result;
}

export function invalidateWhitelistCache(serverId?: string): void {
  if (serverId) {
    whitelistCache.delete(serverId);
    userCacheCache.delete(serverId);
  } else {
    whitelistCache.clear();
    userCacheCache.clear();
  }
}

async function loadUserCache(server: ServerInstance): Promise<WhitelistEntry[]> {
  const key = server.config.id;
  const cached = userCacheCache.get(key);
  if (cached && Date.now() - cached.at < WHITELIST_CACHE_TTL_MS) {
    return cached.data;
  }
  const data = await serverAccess.readUserCache(server.config);
  userCacheCache.set(key, { data, at: Date.now() });
  return data;
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
  forceReload = false,
  server: ServerInstance,
): Promise<WhitelistEntry[]> {
  const [whitelist, usercache] = await Promise.all([
    loadWhitelist(forceReload, server),
    forceReload
      ? serverAccess.readUserCache(server.config).then((data) => {
          userCacheCache.set(server.config.id, { data, at: Date.now() });
          return data;
        })
      : loadUserCache(server),
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
