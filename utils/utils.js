import { exec } from "child_process";
import { promises as fsPromises, existsSync } from "fs";
import path from "path";
import { getServerConfig, sendToServer, isServerRunning, getServerSeed } from "./server.js";

let whitelistCache = null;

export async function deleteStats(uuid) {
  const cfg = getServerConfig();
  const statsPath = path.resolve(cfg.serverDir, "world", "stats", `${uuid}.json`);
  try { await fsPromises.rm(statsPath); return true; }
  catch (err) { if (err.code === "ENOENT") return false; return false; }
}

export { sendToServer, isServerRunning as isScreenRunning, getServerSeed as getSeed };

let lastListOutput = null;
let lastListTime = 0;

export async function getListOutput() {
  const now = Date.now();
  if (now - lastListTime < 500 && lastListOutput) return lastListOutput;
  await sendToServer("/list");
  await new Promise(r => setTimeout(r, 200));
  const output = await getLatestLogs(10);
  lastListOutput = output;
  lastListTime = now;
  return output;
}

export function getLatestLogs(lines = 10, serverDir = null) {
  const cfg = getServerConfig();
  const dir = serverDir || cfg.serverDir;
  const logFile = path.join(dir, "logs", "latest.log");
  return new Promise((resolve, reject) => {
    exec(`tail -n ${lines} "${logFile}"`, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

export function stripLogPrefix(line) {
  if (!line) return "";
  const sep = "]: ";
  let idx = line.lastIndexOf(sep);
  if (idx !== -1) return line.slice(idx + sep.length).trim();
  idx = line.lastIndexOf("]:");
  if (idx !== -1) return line.slice(idx + 2).replace(/^[:\s]+/, "").trim();
  idx = line.lastIndexOf(": ");
  if (idx !== -1) return line.slice(idx + 2).trim();
  return line.trim();
}

export async function loadWhitelist(forceReload = false) {
  if (whitelistCache && !forceReload) return whitelistCache;
  const cfg = getServerConfig();
  const whitelistPath = path.resolve(cfg.serverDir, "whitelist.json");
  const data = await loadJson(whitelistPath);
  if (!Array.isArray(data)) return null;
  if (data.length === 0) return null;
  whitelistCache = data;
  return whitelistCache;
}

export async function getLevelName() {
  const cfg = getServerConfig();
  const propsPath = path.resolve(cfg.serverDir, "server.properties");
  try {
    const content = await fsPromises.readFile(propsPath, "utf-8");
    const match = content.match(/^level-name\s*=\s*(.+)$/m);
    if (match) return match[1].trim();
  } catch { /* ignore */ }
  return "world";
}

function findUpward(startDir, marker) {
  let dir = startDir;
  while (true) {
    if (existsSync(path.join(dir, marker))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

export function getRootDir() {
  const start = process.cwd();
  return findUpward(start, "package.json");
}

export async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) await fsPromises.mkdir(dir, { recursive: true });
  return dir;
}

const jsonCache = new Map();
export async function loadJson(file) {
  try {
    const { mtimeMs } = await fsPromises.stat(file);
    const cached = jsonCache.get(file);
    if (cached && cached.mtimeMs === mtimeMs) return cached.data;
    const raw = await fsPromises.readFile(file, "utf-8");
    const data = JSON.parse(raw);
    jsonCache.set(file, { mtimeMs, data });
    return data;
  } catch { return {}; }
}

export async function saveJson(file, data) {
  await ensureDir(file);
  await fsPromises.writeFile(file, JSON.stringify(data, null, 2));
  const { mtimeMs } = await fsPromises.stat(file);
  jsonCache.set(file, { mtimeMs, data });
}
