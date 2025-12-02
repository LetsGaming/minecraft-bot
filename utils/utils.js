import { exec } from "child_process";
import { promises as fsPromises, existsSync } from "fs";
import path from "path";
import config from "../config.json" assert { type: "json" };
import { execCommand } from "../shell/execCommand.js";

let whitelistCache = null;

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

let lastListOutput = null;
let lastListTime = 0;

/**
 * Get the latest server list output, caching it for 500ms
 * @returns {Promise<string>}
 * This function sends a "/list" command to the server
 * and returns the latest output.
 * If called again within 500ms,
 * it returns the cached output instead.
 */
export async function getListOutput() {
  const now = Date.now();
  if (now - lastListTime < 500 && lastListOutput) return lastListOutput;

  await sendToServer("/list");
  // Wait a moment to ensure the server has processed the command
  await new Promise((resolve) => setTimeout(resolve, 100));
  const output = await getLatestLogs(10);

  lastListOutput = output;
  lastListTime = now;
  return output;
}

/**
 * Read the latest server logs
 * @param {number|null} lines Number of lines from the end to read (like tail)
 * @returns {Promise<string>}
 */
const logFile = path.join(config.serverDir, "logs", "latest.log");
export function getLatestLogs(lines = 10) {
  return new Promise((resolve, reject) => {
    exec(
      `tail -n ${lines} "${logFile}"`,
      { cwd: path.join(config.serverDir, "logs") },
      (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout);
      }
    );
  });
}

/**
 * Strip the typical Minecraft server log prefix from a line.
 * Examples:
 * "[11:44:26] [Server thread/INFO] [net.minecraft.server.dedicated.DedicatedServer]: LetsGamingDE"
 * "[12:00:00] [Server thread/INFO]: player1, player2"
 * "Saved the world"
 * becomes:
 * "LetsGamingDE", "player1, player2", "Saved the world"
 *
 * @param {string} line - a single line from the server log
 * @returns {string} the line content with the log prefix removed
 */
export function stripLogPrefix(line) {
  if (!line) return "";

  // 1) Try standard Minecraft prefix with "]:" (most common)
  const sep = "]: ";
  let idx = line.lastIndexOf(sep);
  if (idx !== -1) return line.slice(idx + sep.length).trim();

  // 2) Try without the space after "]"
  idx = line.lastIndexOf("]:");
  if (idx !== -1) return line.slice(idx + 2).replace(/^[:\s]+/, "").trim();

  // 3) Fallback to last ": " in the line
  idx = line.lastIndexOf(": ");
  if (idx !== -1) return line.slice(idx + 2).trim();

  // 4) Nothing to strip, return trimmed line
  return line.trim();
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

export async function getLevelName() {
  const propsPath = path.resolve(config.serverDir, "server.properties");
  try {
    const content = await fsPromises.readFile(propsPath, "utf-8");
    const match = content.match(/^level-name\s*=\s*(.+)$/m);
    if (match) {
      return match[1].trim();
    }
  } catch (err) {
    console.warn(`Could not read server.properties: ${err.message}`);
  }
  // Default fallback if nothing found
  return "world";
}

export async function getSeed() {
  // check if seed is enabled in config
  if(!config.commands.seed.enabled) {
    return null;
  }

  await sendToServer("/seed");
  // Wait a moment to ensure the server has processed the command
  await new Promise((resolve) => setTimeout(resolve, 100));
  const output = await getLatestLogs(10);
  const lines = output.split("\n");
  for (const line of lines.reverse()) {
    const match = line.match(/Seed: \[(-?\d+)\]/);

    if (match) {
      return match[1];
    }
  }
  return null;
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

/**
 * Sends a command to the Minecraft server screen session.
 *
 * @param {string} command - The command to send (without newline)
 * @returns {Promise<void>}
 */
export async function sendToServer(command) {
  const fullCommand = `sudo -u ${config.linuxUser} screen -S ${config.screenSession} -X stuff "${command}$(printf '\\r')"`;
  await execCommand(fullCommand);
}
