import { loadKnownPlayers } from "./whitelist.js";
import * as serverAccess from "../server/serverAccess.js";
import type { ServerInstance } from "../server/server.js";
import type {
  PlayerCoords,
  PlayerCount,
  WhitelistEntry,
} from "../../types/index.js";

const LOOKAHEAD_LINES = 5;

// `/list` output only reaches the log a moment after the command is sent,
// so the read is a short poll. Cached per server ID — module-level state
// used to hand server A's output back when server B asked inside the window.
const LIST_OUTPUT_CACHE_MS = 500;
const LIST_POLL_ATTEMPTS = 3;
const LIST_POLL_DELAY_MS = 300;
const LIST_TAIL_LINES = 10;

const listOutputCache = new Map<string, { output: string; time: number }>();

/**
 * Send `/list` and return the log tail containing its answer, or null if
 * the server never printed one. The screen-mode fallback for servers
 * without RCON — `ServerInstance.getList()` is the fast path.
 */
export async function getListOutput(
  server?: ServerInstance,
): Promise<string | null> {
  if (!server) return null;
  const key = server.id;
  const now = Date.now();
  const cached = listOutputCache.get(key);
  if (cached && now - cached.time < LIST_OUTPUT_CACHE_MS) return cached.output;

  await server.sendCommand("/list");
  for (let i = 0; i < LIST_POLL_ATTEMPTS; i++) {
    await new Promise<void>((r) => setTimeout(r, LIST_POLL_DELAY_MS));
    const output = await serverAccess.tailLog(server.config, LIST_TAIL_LINES);
    if (output.includes("players online")) {
      listOutputCache.set(key, { output, time: now });
      return output;
    }
  }
  return null;
}

/** Strip the `[HH:MM:SS] [Server thread/INFO]: ` prefix from a log line. */
export function stripLogPrefix(line: string): string {
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

export async function getPlayerNamesChoices(
  server: ServerInstance,
): Promise<Array<{ name: string; value: string }>> {
  const names = await getPlayerNames(server);
  return names.map((n) => ({ name: n, value: n }));
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
  server?: ServerInstance,
): Promise<PlayerCount> {
  if (server) {
    const list = await server.getList();
    return { playerCount: list.playerCount, maxPlayers: list.maxPlayers };
  }
  const logContent = await getListOutput();
  if (!logContent) return { playerCount: "unknown", maxPlayers: "unknown" };
  const parsed = parseListOutput(logContent);
  return { playerCount: parsed.playerCount, maxPlayers: parsed.maxPlayers };
}

/**
 * Get online players — uses RCON/API when available, falls back to log parsing.
 */
export async function getOnlinePlayers(
  server?: ServerInstance,
): Promise<string[]> {
  if (server) {
    const list = await server.getList();
    return list.players;
  }
  const logContent = await getListOutput();
  if (!logContent) return [];
  return parseListOutput(logContent).players;
}

/**
 * Get player coordinates — delegates to ServerInstance which owns the
 * single canonical implementation of the coordinate regex.
 */
export async function getPlayerCoords(
  server: ServerInstance,
  playerName: string,
): Promise<PlayerCoords | null> {
  return server.getPlayerCoords(playerName);
}

/**
 * Get player dimension — delegates to ServerInstance which owns the
 * single canonical implementation of the dimension regex.
 */
export async function getPlayerDimension(
  server: ServerInstance,
  playerName: string,
): Promise<string> {
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
