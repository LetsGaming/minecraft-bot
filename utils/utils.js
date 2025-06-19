import fs from "fs";
import { promises as fsPromises, existsSync } from "fs";
import path from "path";
import readline from "readline";
import config from "../config.json" assert { type: "json" };
import { sendToServer } from "./sendToServer.js";
import { execCommand } from "../shell/execCommand.js";

let whitelistCache = null;

/**
 * Find a player object from whitelist by playerName (case insensitive)
 * @param {string} playerName
 * @returns {Promise<object|null>} player object or null if not found
 */
export async function findPlayer(playerName) {
  const whitelist = await loadWhitelist();
  if (!whitelist) return null;

  const lowerName = playerName.toLowerCase();
  return whitelist.find((p) => p.name.toLowerCase() === lowerName) ?? null;
}

/**
 * Delete player stats file by UUID
 * @param {string} uuid
 * @returns {Promise<boolean>}
 */
export async function deleteStats(uuid) {
  const statsPath = path.resolve(
    config.serverDir,
    "world",
    "stats",
    `${uuid}.json`
  );
  try {
    await fsPromises.rm(statsPath);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    console.error(`Error deleting stats file: ${err}`);
    return false;
  }
}

/**
 * Read the latest server logs
 * @param {number|null} lines Number of lines from the end to read (like tail)
 * @returns {Promise<string>}
 */
export async function getLatestLogs(lines = null) {
  const logFile = path.join(config.serverDir, "logs", "latest.log");

  if (lines == null) {
    return fsPromises.readFile(logFile, "utf-8");
  }

  const fileStream = fs.createReadStream(logFile);
  const rl = readline.createInterface({ input: fileStream });
  const buffer = [];

  for await (const line of rl) {
    buffer.push(line);
    if (buffer.length > lines) buffer.shift();
  }

  return buffer.join("\n");
}

/**
 * Ask the server for player count and parse from logs
 * @returns {Promise<{playerCount: string, maxPlayers: string}>}
 */
export async function getPlayerCount() {
  await sendToServer("/list");

  const logContent = await getLatestLogs(10);
  if (!logContent) {
    return {
      playerCount: "unknown",
      maxPlayers: "unknown",
    };
  }

  const list = logContent
    .split("\n")
    .reverse()
    .find(
      (line) => line.includes("There are") && line.includes("players online")
    );

  const match = list?.match(/There are (\d+) of a max of (\d+) players online/);
  return {
    playerCount: match?.[1] ?? "unknown",
    maxPlayers: match?.[2] ?? "unknown",
  };
}

/**
 * Get a list of online players from the latest logs
 * @returns {Promise<string[]>} Array of player names
 */
export async function getOnlinePlayers() {
  await sendToServer("/list");

  const logContent = await getLatestLogs(10);
  if (!logContent) return [];

  const list = logContent
    .split("\n")
    .reverse()
    .find(
      (line) => line.includes("There are") && line.includes("players online")
    );

  const match = list?.match(/There are \d+ players online: (.+)/);
  if (!match || !match[1]) return [];

  return match[1].split(",").map((name) => name.trim());
}

/**
 * Load and optionally cache the whitelist
 * @param {boolean} forceReload If true, bypass cache and reload from disk
 * @returns {Promise<object[]|null>}
 */
export async function loadWhitelist(forceReload = false) {
  if (whitelistCache && !forceReload) return whitelistCache;

  const whitelistPath = path.resolve(config.serverDir, "whitelist.json");
  const data = await loadJson(whitelistPath);

  if (!Array.isArray(data)) {
    console.error("Whitelist is not an array or does not exist.");
    return null;
  }
  if (data.length === 0) {
    console.warn("Whitelist is empty.");
    return null;
  }

  whitelistCache = data;
  return whitelistCache;
}

/**
 * Walks up from `startDir` until it finds a directory
 * containing `markerFilename`. Returns the directory path,
 * or `process.cwd()` if no marker is ever found.
 */
function findUpward(startDir, markerFilename) {
  let dir = startDir;
  while (true) {
    // If we find the marker here, we’re done.
    if (existsSync(path.join(dir, markerFilename))) {
      return dir;
    }
    // Otherwise go up one level
    const parent = path.dirname(dir);
    // If we can’t go any further up, give up
    if (parent === dir) {
      return startDir;
    }
    dir = parent;
  }
}

// Ensure parent directory exists
export async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    await fsPromises.mkdir(dir, { recursive: true });
  }
  return dir;
}

/**
 * Returns the “project root” directory by looking for a
 * package.json (or .git folder) upwards from cwd.
 */
export function getRootDir() {
  // Start search from the current working directory
  const start = process.cwd();

  // Look first for a package.json…
  const pkgRoot = findUpward(start, "package.json");
  if (pkgRoot !== start) {
    return pkgRoot;
  }

  // If does not exists, just return cwd
  return start;
}

const jsonCache = new Map();

/**
 * Load JSON file from disk with simple mtime-based caching
 * @param {string} file
 * @returns {Promise<any>}
 */
export async function loadJson(file) {
  try {
    const { mtimeMs } = await fsPromises.stat(file);
    const cached = jsonCache.get(file);

    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.data;
    }

    const raw = await fsPromises.readFile(file, "utf-8");
    const data = JSON.parse(raw);
    jsonCache.set(file, { mtimeMs, data });
    return data;
  } catch (err) {
    return {};
  }
}

/**
 * Save object as JSON file and update cache
 * @param {string} file
 * @param {any} data
 * @returns {Promise<void>}
 */
export async function saveJson(file, data) {
  await ensureDir(file);
  await fsPromises.writeFile(file, JSON.stringify(data, null, 2));

  const { mtimeMs } = await fsPromises.stat(file);
  jsonCache.set(file, { mtimeMs, data });
}

export async function isScreenRunning() {
  const screenCmd = `sudo -u ${config.linuxUser} screen -list`;
  const output = await execCommand(screenCmd);

  const isRunning = new RegExp(`\\b\\d+\\.${config.screenSession}\\b`).test(
    output
  );

  return isRunning;
}
