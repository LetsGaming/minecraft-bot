import {
  getListOutput,
  stripLogPrefix,
  getLatestLogs,
  loadWhitelist,
} from "./utils.js";
import {
  sendToServer,
  getPlayerData,
  getServerConfig,
  getServerList,
} from "./server.js";

const LOOKAHEAD_LINES = 5;

// Lazy-loaded player names (no more top-level await crash)
let _playerNamesCache = null;

export async function getPlayerNamesChoices() {
  const names = await getPlayerNames();
  return names.map((n) => ({ name: n, value: n }));
}

/**
 * Find a player object from whitelist by name (case insensitive)
 */
export async function findPlayer(playerName) {
  const names = await getPlayerNames();
  const lowerName = playerName.toLowerCase();
  const index = names.findIndex((n) => n.toLowerCase() === lowerName);
  if (index === -1) return null;
  const whitelist = await loadWhitelist();
  return whitelist[index] || null;
}

/**
 * Get all player names from the whitelist
 */
export async function getPlayerNames() {
  const whitelist = await loadWhitelist();
  return whitelist ? whitelist.map((p) => p.name) : [];
}

/**
 * Get player count — uses RCON when available
 */
export async function getPlayerCount() {
  const cfg = getServerConfig();
  if (cfg.useRcon && cfg.rconPassword) {
    const list = await getServerList();
    return { playerCount: list.playerCount, maxPlayers: list.maxPlayers };
  }

  // Screen fallback
  const logContent = await getListOutput();
  if (!logContent) return { playerCount: "unknown", maxPlayers: "unknown" };
  const parsed = parseListOutput(logContent);
  return {
    playerCount: parsed.playerCount ?? "unknown",
    maxPlayers: parsed.maxPlayers ?? "unknown",
  };
}

/**
 * Get online players — uses RCON when available
 */
export async function getOnlinePlayers() {
  const cfg = getServerConfig();
  if (cfg.useRcon && cfg.rconPassword) {
    const list = await getServerList();
    return list.players;
  }

  const logContent = await getListOutput();
  if (!logContent) return [];
  const parsed = parseListOutput(logContent);
  return parsed.players ?? [];
}

/**
 * Get player coordinates — uses RCON direct response when available
 */
export async function getPlayerCoords(playerName) {
  const response = await getPlayerData(playerName, "Pos");

  if (response) {
    // RCON returns the data directly
    const match = response.match(
      /\[([\d.+-]+)d,\s*([\d.+-]+)d,\s*([\d.+-]+)d\]/,
    );
    if (match)
      return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
  }

  // Screen fallback — command was sent, check logs
  await new Promise((r) => setTimeout(r, 150));
  const output = await getLatestLogs(10);
  const match = output.match(/\[([\d.+-]+)d,\s*([\d.+-]+)d,\s*([\d.+-]+)d\]/);
  if (!match) return null;
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
}

/**
 * Get player dimension — uses RCON direct response when available
 */
export async function getPlayerDimension(playerName) {
  const response = await getPlayerData(playerName, "Dimension");

  if (response) {
    const match = response.match(/"minecraft:([^"]+)"/);
    if (match) return match[1];
  }

  // Screen fallback
  await new Promise((r) => setTimeout(r, 150));
  const output = await getLatestLogs(10);
  const match = output.match(/"minecraft:([^"]+)"/);
  return match ? match[1] : "overworld";
}

// ── Log parsing (screen fallback) ──

export function parseListOutput(logContent) {
  if (!logContent)
    return { playerCount: "unknown", maxPlayers: "unknown", players: [] };
  const lines = logContent.split(/\r?\n/);
  const idx = findLastPlayerLine(lines);
  if (idx === -1)
    return { playerCount: "unknown", maxPlayers: "unknown", players: [] };
  const counts = parseCounts(lines[idx]);
  const inlinePlayers = parseInlinePlayers(lines[idx]);
  if (inlinePlayers) return { ...counts, players: inlinePlayers };
  const nextLinePlayers = parseNextLinesPlayers(lines, idx);
  return { ...counts, players: nextLinePlayers };
}

function findLastPlayerLine(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes("There are") && lines[i].includes("players online"))
      return i;
  }
  return -1;
}

function parseCounts(line) {
  const content = stripLogPrefix(line);
  const match =
    content.match(
      /There are\s+(\d+)\s*of a max of\s*(\d+)\s*players online/i,
    ) ||
    content.match(/There are\s+(\d+)\s*\/\s*(\d+)\s*players online/i) ||
    content.match(/There are\s+(\d+)\s*players online/i);
  return {
    playerCount: match ? match[1] : "unknown",
    maxPlayers: match?.[2] || "unknown",
  };
}

function parseInlinePlayers(line) {
  const content = stripLogPrefix(line);
  const match = content.match(/players online\s*:\s*(.*)$/i);
  if (!match?.[1]) return null;
  return match[1]
    .split(",")
    .map((s) => s.trim().replace(/§./g, ""))
    .filter(Boolean);
}

function parseNextLinesPlayers(lines, startIdx) {
  for (
    let j = startIdx + 1;
    j < Math.min(lines.length, startIdx + LOOKAHEAD_LINES);
    j++
  ) {
    const raw = lines[j];
    if (!raw) continue;
    let candidate = stripLogPrefix(raw);
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
