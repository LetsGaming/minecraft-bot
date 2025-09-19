import { getListOutput, stripLogPrefix } from "./utils.js";
const LOOKAHEAD_LINES = 5; // how many lines to look ahead for player names after the count line

/**
 * Ask the server for player count and parse from logs
 * @returns {Promise<{playerCount: string, maxPlayers: string}>}
 */
export async function getPlayerCount() {
  const logContent = await getListOutput();
  if (!logContent) {
    return {
      playerCount: "unknown",
      maxPlayers: "unknown",
    };
  }
  const parsed = parseListOutput(logContent);
  return {
    playerCount: parsed.playerCount ?? "unknown",
    maxPlayers: parsed.maxPlayers ?? "unknown",
  };
}

/**
 * Get a list of online players from the latest logs
 * @returns {Promise<string[]>} Array of player names
 */
export async function getOnlinePlayers() {
  const logContent = await getListOutput();
  if (!logContent) return [];
  const parsed = parseListOutput(logContent);
  return parsed.players ?? [];
}

/**
 * Main parser: parse a block of log content and return counts + player list
 */
export function parseListOutput(logContent) {
  if (!logContent) return { playerCount: "unknown", maxPlayers: "unknown", players: [] };

  const lines = logContent.split(/\r?\n/);
  const idx = findLastPlayerLine(lines);
  if (idx === -1) return { playerCount: "unknown", maxPlayers: "unknown", players: [] };

  const counts = parseCounts(lines[idx]);
  const inlinePlayers = parseInlinePlayers(lines[idx]);
  if (inlinePlayers) return { ...counts, players: inlinePlayers };

  const nextLinePlayers = parseNextLinesPlayers(lines, idx);
  return { ...counts, players: nextLinePlayers };
}


/**
 * Checks whether a string looks like a player list
 */
function isLikelyNameList(candidate) {
  if (!candidate) return false;
  const plain = candidate.replace(/§./g, "").trim(); // remove color codes
  return /^[\w,\- ]+$/.test(plain);
}

/**
 * Find last "There are ... players online" line in log
 */
function findLastPlayerLine(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.includes("There are") && l.includes("players online")) return i;
  }
  return -1;
}

/**
 * Parse player counts from a line
 */
function parseCounts(line) {
  const content = stripLogPrefix(line);
  const match =
    content.match(/There are\s+(\d+)\s*of a max of\s*(\d+)\s*players online/i) ||
    content.match(/There are\s+(\d+)\s*\/\s*(\d+)\s*players online/i) ||
    content.match(/There are\s+(\d+)\s*players online/i);
  const playerCount = match ? match[1] : "unknown";
  const maxPlayers = match && match[2] ? match[2] : "unknown";
  return { playerCount, maxPlayers };
}

/**
 * Extract inline player list from the line (newer versions)
 */
function parseInlinePlayers(line) {
  const content = stripLogPrefix(line);
  const match = content.match(/players online\s*:\s*(.*)$/i);
  if (!match || !match[1]) return null;
  return match[1]
    .split(",")
    .map((s) => s.trim().replace(/§./g, ""))
    .filter(Boolean);
}

/**
 * Scan following lines for player list (older versions)
 */
function parseNextLinesPlayers(lines, startIdx) {
  for (let j = startIdx + 1; j < Math.min(lines.length, startIdx + LOOKAHEAD_LINES); j++) {
    const candidateRaw = lines[j];
    if (!candidateRaw) continue;
    let candidate = stripLogPrefix(candidateRaw);
    if (!candidate) continue;

    const lower = candidate.toLowerCase();
    if (
      lower.includes("saving") ||
      lower.includes("starting") ||
      lower.includes("stopping") ||
      lower.includes("backup") ||
      lower.includes("joined the game") ||
      lower.includes("left the game") ||
      lower.includes("players online")
    ) continue;

    if (isLikelyNameList(candidate)) return candidate.split(",").map((s) => s.trim().replace(/§./g, "")).filter(Boolean);

    const maybeStripped = candidate.replace(/^\[.*?\]\s*/, "");
    if (isLikelyNameList(maybeStripped)) return maybeStripped.split(",").map((s) => s.trim().replace(/§./g, "")).filter(Boolean);
  }
  return [];
}
