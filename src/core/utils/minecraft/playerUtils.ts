import { loadKnownPlayers } from "./whitelist.js";
import type { ServerInstance } from "../server/server.js";
import type { QueryResult } from "../server/queryResult.js";
import type {
  PlayerCoords,
  WhitelistEntry,
} from "../../types/index.js";

/**
 * Find a player by name (case insensitive) among everyone the server
 * knows: whitelist first, then usercache — so lookups work on servers
 * that run without a whitelist. Searches a single list so a cache
 * invalidation mid-call can't produce a name/uuid mismatch.
 */
export async function findPlayer(
  playerName: string,
  server: ServerInstance,
): Promise<WhitelistEntry | null> {
  const players = await loadKnownPlayers(server);
  const lower = playerName.toLowerCase();
  return players.find((p) => p.name.toLowerCase() === lower) ?? null;
}

/** All player names the server knows (whitelist + usercache). */
export async function getPlayerNames(
  server: ServerInstance,
): Promise<string[]> {
  const players = await loadKnownPlayers(server);
  return players.map((p) => p.name);
}

/**
 * Online players. When the wrapper could not be asked this is an empty list,
 * which callers read as "nobody to find": the safe side for the one caller
 * that branches on it (a reward goes out the offline way).
 */
export async function getOnlinePlayers(
  server: ServerInstance,
): Promise<string[]> {
  const list = await server.getList();
  return list.ok ? list.value.players : [];
}

/**
 * Is this player on the server right now?
 *
 * Minecraft names are case-preserving but matched case-insensitively, and
 * every other comparison in this codebase normalises before comparing. The
 * daily command did not: it ran `getOnlinePlayers().includes(username)`
 * against the name stored at link time, so a player who linked as
 * "letsgamingde" and appears in the roster as "LetsGamingDE" was never seen
 * as online, and every claim took the offline path forever.
 */
export function isPlayerOnline(
  onlinePlayers: readonly string[],
  username: string,
): boolean {
  const lower = username.toLowerCase();
  return onlinePlayers.some((p) => p.toLowerCase() === lower);
}

/**
 * Get player coordinates — delegates to ServerInstance which owns the
 * single canonical implementation of the coordinate regex.
 */
export async function getPlayerCoords(
  server: ServerInstance,
  playerName: string,
): Promise<QueryResult<PlayerCoords>> {
  return server.getPlayerCoords(playerName);
}

/**
 * Get player dimension — delegates to ServerInstance which owns the
 * single canonical implementation of the dimension regex.
 */
export async function getPlayerDimension(
  server: ServerInstance,
  playerName: string,
): Promise<QueryResult<string>> {
  return server.getPlayerDimension(playerName);
}
