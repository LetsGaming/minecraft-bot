import { loadKnownPlayers } from "./whitelist.js";
import type { ServerInstance } from "../server/server.js";
import type { QueryResult } from "../server/queryResult.js";
import type {
  PlayerCoords,
  PlayerCount,
  WhitelistEntry,
} from "../../types/index.js";

const LOOKAHEAD_LINES = 5;

/**
 * Strip the `[HH:MM:SS] [Server thread/INFO]: ` prefix from a log line, and the
 * `System chat: ` marker Minecraft 26.3 adds behind it.
 */
export function stripLogPrefix(line: string): string {
  return stripTags(line).replace(/^System chat:\s+/, "");
}

function stripTags(line: string): string {
  if (!line) return "";
  const sep = "]: ";
  let idx = line.lastIndexOf(sep);
  if (idx !== -1) return line.slice(idx + sep.length).trim();
  idx = line.lastIndexOf("]:");
  if (idx !== -1)
    return line
      .slice(idx + 2)
      .replace(/^[:\s]+/, "")
      .trim();
  idx = line.lastIndexOf(": ");
  if (idx !== -1) return line.slice(idx + 2).trim();
  return line.trim();
}

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
  const players = await loadKnownPlayers(false, server);
  const lower = playerName.toLowerCase();
  return players.find((p) => p.name.toLowerCase() === lower) ?? null;
}

/** All player names the server knows (whitelist + usercache). */
export async function getPlayerNames(
  server: ServerInstance,
): Promise<string[]> {
  const players = await loadKnownPlayers(false, server);
  return players.map((p) => p.name);
}

/**
 * Get player count — uses RCON/API when available, falls back to log parsing.
 */
export async function getPlayerCount(
  server: ServerInstance,
): Promise<PlayerCount> {
  const list = await server.getList();
  return { playerCount: list.playerCount, maxPlayers: list.maxPlayers };
}

/**
 * Get online players — uses RCON/API when available, falls back to log parsing.
 */
export async function getOnlinePlayers(
  server: ServerInstance,
): Promise<string[]> {
  const list = await server.getList();
  return list.players;
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

// ── Log parsing (screen fallback) ──

interface ParsedListOutput {
  playerCount: string;
  maxPlayers: string;
  players: string[];
}

export function parseListOutput(logContent: string | null): ParsedListOutput {
  if (!logContent)
    return { playerCount: "unknown", maxPlayers: "unknown", players: [] };
  const lines = logContent.split(/\r?\n/);
  const idx = findLastPlayerLine(lines);
  if (idx === -1)
    return { playerCount: "unknown", maxPlayers: "unknown", players: [] };
  const counts = parseCounts(lines[idx]!);
  const inlinePlayers = parseInlinePlayers(lines[idx]!);
  if (inlinePlayers) return { ...counts, players: inlinePlayers };
  const nextLinePlayers = parseNextLinesPlayers(lines, idx);
  return { ...counts, players: nextLinePlayers };
}

function findLastPlayerLine(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.includes("There are") && lines[i]!.includes("players online"))
      return i;
  }
  return -1;
}

function parseCounts(line: string): {
  playerCount: string;
  maxPlayers: string;
} {
  const content = stripLogPrefix(line);
  const match =
    content.match(
      /There are\s+(\d+)\s*of a max of\s*(\d+)\s*players online/i,
    ) ??
    content.match(/There are\s+(\d+)\s*\/\s*(\d+)\s*players online/i) ??
    content.match(/There are\s+(\d+)\s*players online/i);
  return {
    playerCount: match?.[1] ?? "unknown",
    maxPlayers: match?.[2] ?? "unknown",
  };
}

function parseInlinePlayers(line: string): string[] | null {
  const content = stripLogPrefix(line);
  const match = content.match(/players online\s*:\s*(.*)$/i);
  if (!match?.[1]) return null;
  return match[1]
    .split(",")
    .map((s) => s.trim().replace(/§./g, ""))
    .filter(Boolean);
}

function parseNextLinesPlayers(lines: string[], startIdx: number): string[] {
  for (
    let j = startIdx + 1;
    j < Math.min(lines.length, startIdx + LOOKAHEAD_LINES);
    j++
  ) {
    const raw = lines[j];
    if (!raw) continue;
    const candidate = stripLogPrefix(raw);
    if (!candidate) continue;
    const lower = candidate.toLowerCase();
    if (
      [
        "saving",
        "starting",
        "stopping",
        "backup",
        "joined the game",
        "left the game",
        "players online",
      ].some((k) => lower.includes(k))
    )
      continue;
    if (/^[\w,\- ]+$/.test(candidate))
      return candidate
        .split(",")
        .map((s) => s.trim().replace(/§./g, ""))
        .filter(Boolean);
  }
  return [];
}
