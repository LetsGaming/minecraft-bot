import fs from "fs";
import { promises as fsPromises } from "fs";
import path from "path";
import readline from "readline";
import config from "../config.json" assert { type: "json" };
import { sendToServer } from "./sendToServer.js";

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
  await fsPromises.mkdir(path.dirname(file), { recursive: true });
  await fsPromises.writeFile(file, JSON.stringify(data, null, 2));

  const { mtimeMs } = await fsPromises.stat(file);
  jsonCache.set(file, { mtimeMs, data });
}
