/** Whitelist and usercache reads. */

import { log } from "../../logger.js";
import type { ServerConfig, WhitelistEntry } from "../../../types/index.js";
import { errMsg } from "../../error.js";
import { apiGet } from "./apiClient.js";

/** Read the server's whitelist. */
export async function readWhitelist(
  cfg: ServerConfig,
): Promise<WhitelistEntry[]> {
  const { whitelist } = await apiGet<{ whitelist: WhitelistEntry[] }>(
    cfg,
    "/whitelist",
  );
  return whitelist;
}

/**
 * Read usercache.json (every player the server has ever seen, whitelist or
 * not). Returns [] on any error, including remote wrappers that predate the
 * /usercache endpoint — callers treat the cache as a best-effort name
 * source on top of the whitelist.
 */
export async function readUserCache(
  cfg: ServerConfig,
): Promise<WhitelistEntry[]> {
  try {
    const { usercache } = await apiGet<{ usercache: WhitelistEntry[] }>(
      cfg,
      "/usercache",
    );
    return Array.isArray(usercache) ? usercache : [];
  } catch (err) {
    log.debug("serverAccess", `usercache unavailable for ${cfg.id}: ${errMsg(err)}`);
    return [];
  }
}
