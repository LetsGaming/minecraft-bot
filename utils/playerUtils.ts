import {
  getListOutput,
  stripLogPrefix,
  loadWhitelist,
} from './utils.js';
import {
  getPlayerData,
  getServerConfig,
  getServerList,
} from './server.js';
import type { ServerInstance } from './server.js';
import type {
  PlayerCoords,
  PlayerCount,
  WhitelistEntry,
} from '../types/index.js';

const LOOKAHEAD_LINES = 5;

export async function getPlayerNamesChoices(): Promise<Array<{ name: string; value: string }>> {
  const names = await getPlayerNames();
  return names.map((n) => ({ name: n, value: n }));
}

/**
 * Find a player object from whitelist by name (case insensitive)
 */
export async function findPlayer(playerName: string): Promise<WhitelistEntry | null> {
  const names = await getPlayerNames();
  const lowerName = playerName.toLowerCase();
  const index = names.findIndex((n) => n.toLowerCase() === lowerName);
  if (index === -1) return null;
  const whitelist = await loadWhitelist();
  return whitelist?.[index] ?? null;
}

/**
 * Get all player names from the whitelist
 */
export async function getPlayerNames(): Promise<string[]> {
  const whitelist = await loadWhitelist();
  return whitelist ? whitelist.map((p) => p.name) : [];
}

/**
 * Get player count — uses RCON when available
 */
export async function getPlayerCount(): Promise<PlayerCount> {
  const cfg = getServerConfig();
  if (cfg.useRcon && cfg.rconPassword) {
    const list = await getServerList();
    return { playerCount: list.playerCount, maxPlayers: list.maxPlayers };
  }

  const logContent = await getListOutput();
  if (!logContent) return { playerCount: 'unknown', maxPlayers: 'unknown' };
  const parsed = parseListOutput(logContent);
  return {
    playerCount: parsed.playerCount,
    maxPlayers: parsed.maxPlayers,
  };
}

/**
 * Get online players — uses RCON when available
 */
export async function getOnlinePlayers(): Promise<string[]> {
  const cfg = getServerConfig();
  if (cfg.useRcon && cfg.rconPassword) {
    const list = await getServerList();
    return list.players;
  }

  const logContent = await getListOutput();
  if (!logContent) return [];
  const parsed = parseListOutput(logContent);
  return parsed.players;
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
    return { playerCount: 'unknown', maxPlayers: 'unknown', players: [] };
  const lines = logContent.split(/\r?\n/);
  const idx = findLastPlayerLine(lines);
  if (idx === -1)
    return { playerCount: 'unknown', maxPlayers: 'unknown', players: [] };
  const counts = parseCounts(lines[idx]!);
  const inlinePlayers = parseInlinePlayers(lines[idx]!);
  if (inlinePlayers) return { ...counts, players: inlinePlayers };
  const nextLinePlayers = parseNextLinesPlayers(lines, idx);
  return { ...counts, players: nextLinePlayers };
}

function findLastPlayerLine(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.includes('There are') && lines[i]!.includes('players online'))
      return i;
  }
  return -1;
}

function parseCounts(line: string): { playerCount: string; maxPlayers: string } {
  const content = stripLogPrefix(line);
  const match =
    content.match(
      /There are\s+(\d+)\s*of a max of\s*(\d+)\s*players online/i,
    ) ??
    content.match(/There are\s+(\d+)\s*\/\s*(\d+)\s*players online/i) ??
    content.match(/There are\s+(\d+)\s*players online/i);
  return {
    playerCount: match?.[1] ?? 'unknown',
    maxPlayers: match?.[2] ?? 'unknown',
  };
}

function parseInlinePlayers(line: string): string[] | null {
  const content = stripLogPrefix(line);
  const match = content.match(/players online\s*:\s*(.*)$/i);
  if (!match?.[1]) return null;
  return match[1]
    .split(',')
    .map((s) => s.trim().replace(/§./g, ''))
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
        'saving',
        'starting',
        'stopping',
        'backup',
        'joined the game',
        'left the game',
        'players online',
      ].some((k) => lower.includes(k))
    )
      continue;
    if (/^[\w,\- ]+$/.test(candidate))
      return candidate
        .split(',')
        .map((s) => s.trim().replace(/§./g, ''))
        .filter(Boolean);
  }
  return [];
}
