/** Level name and per-player stats files. */

import type { ServerConfig, MinecraftStatsFile } from "../../../types/index.js";
import { apiGetRaw, readApiJson, apiGet, apiDelete } from "./apiClient.js";

/**
 * Defense-in-depth at the sink: every UUID used here currently comes from
 * Mojang or the server's own files, but assert the shape right before any
 * `path.join`/URL interpolation anyway so a future caller can't introduce
 * path traversal.
 */
const UUID_FORMAT = /^[0-9a-fA-F-]{32,36}$/;

function assertUuidFormat(uuid: string): void {
  if (!UUID_FORMAT.test(uuid)) {
    throw new Error(
      `Invalid UUID format: ${JSON.stringify(String(uuid).slice(0, 64))}`,
    );
  }
}

/** Read level-name from server.properties. Falls back to "world". */
export async function readLevelName(cfg: ServerConfig): Promise<string> {
  const { levelName } = await apiGet<{ levelName: string }>(cfg, "/level-name");
  return levelName;
}

/** Load a single player's stats JSON. Returns null if not found. */
export async function readStats(
  cfg: ServerConfig,
  uuid: string,
): Promise<MinecraftStatsFile | null> {
  assertUuidFormat(uuid); // guard the path/route sink
  // A player with no stats file is a normal answer, not a failure: they have
  // simply never played here, and the wrapper says 404. Letting that throw
  // surfaced as "Failed to retrieve stats" (and an ERROR log) instead of the
  // "Stats File Not Found" reply the caller already handles. A 500 still
  // throws — "the read broke" must not look like "this player has none".
  const res = await apiGetRaw(cfg, `/stats/${uuid}`);
  if (res.status === 404) return null;
  const { stats } = await readApiJson<{ stats: MinecraftStatsFile | null }>(
    res,
    `/stats/${uuid}`,
  );
  return stats;
}

/** List all UUIDs that have a stats file on this server. */
export async function listStatsUuids(cfg: ServerConfig): Promise<string[]> {
  const { uuids } = await apiGet<{ uuids: string[] }>(cfg, "/stats");
  return uuids;
}

/**
 * Every player's stats in one wrapper request, from a wrapper new enough to
 * serve it. Null (not thrown) on a 404 so the caller can fall back to the
 * per-uuid path without treating an older wrapper as an error — the same
 * "degrade per route" pattern every other optional feature here follows.
 */
export async function readAllStats(
  cfg: ServerConfig,
): Promise<Record<string, MinecraftStatsFile> | null> {
  const res = await apiGetRaw(cfg, "/stats/bulk");
  if (res.status === 404) return null;
  const { stats } = await readApiJson<{ stats: Record<string, MinecraftStatsFile> }>(
    res,
    "/stats/bulk",
  );
  return stats;
}

/** Delete a player's stats file via the wrapper. */
export async function deleteStatsFile(
  cfg: ServerConfig,
  uuid: string,
): Promise<boolean> {
  assertUuidFormat(uuid); // guard the path/route sink
  // The wrapper exposes DELETE /stats/:uuid so the
  // admin-gated /server prune-stats works on remote instances too.
  // Older wrappers without the route (or any transport error) degrade
  // to "not deleted" — prune-stats then reports 0 deletions instead of
  // failing the whole command.
  try {
    const { deleted } = await apiDelete<{ deleted: boolean }>(
      cfg,
      `/stats/${encodeURIComponent(uuid)}`,
    );
    return deleted === true;
  } catch {
    return false;
  }
}
