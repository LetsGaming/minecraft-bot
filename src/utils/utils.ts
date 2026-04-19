import { promises as fsPromises, existsSync } from "fs";
import path from "path";
import type { JsonCacheEntry, WhitelistEntry } from "../types/index.js";
import type { ServerInstance } from "./server.js";
import { getServerConfig } from "./server.js";
import * as serverAccess from "./serverAccess.js";

// ── Whitelist ─────────────────────────────────────────────────────────────

// Per-server cache keyed by server ID so multi-instance setups don't bleed.
const whitelistCache = new Map<string, WhitelistEntry[] | null>();

/**
 * Load the whitelist for the given server (defaults to the "default" instance).
 * Routes through serverAccess so remote servers fetch from the API wrapper.
 */
export async function loadWhitelist(
  forceReload = false,
  server?: ServerInstance,
): Promise<WhitelistEntry[] | null> {
  const cfg = server?.config ?? getServerConfig();
  const key = cfg.id;

  if (!forceReload && whitelistCache.has(key))
    return whitelistCache.get(key) ?? null;

  const data = await serverAccess.readWhitelist(cfg);
  const result = data.length > 0 ? data : null;
  whitelistCache.set(key, result);
  return result;
}

export function invalidateWhitelistCache(serverId?: string): void {
  if (serverId) whitelistCache.delete(serverId);
  else whitelistCache.clear();
}

// ── Level name ────────────────────────────────────────────────────────────

const levelNameCache = new Map<string, string>();

export async function getLevelName(server?: ServerInstance): Promise<string> {
  const cfg = server?.config ?? getServerConfig();
  const key = cfg.id;
  if (levelNameCache.has(key)) return levelNameCache.get(key)!;
  const name = await serverAccess.readLevelName(cfg);
  levelNameCache.set(key, name);
  return name;
}

// ── Log tailing ───────────────────────────────────────────────────────────

/**
 * Return the last N lines of latest.log.
 * `serverDir` param kept for backward compat with local call sites in server.ts
 * that pass it directly; those will be local-only, so the path override still works.
 */
export async function getLatestLogs(
  lines = 10,
  serverDir?: string,
  server?: ServerInstance,
): Promise<string> {
  // If a server instance is provided, route through serverAccess (handles remote).
  if (server) return serverAccess.tailLog(server.config, lines);

  // Legacy local-only path: use serverDir override or default config.
  const cfg = getServerConfig();
  const dir = serverDir ?? cfg.serverDir;
  const logFile = path.join(dir, "logs", "latest.log");
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);
  try {
    const { stdout } = await execAsync(`tail -n ${lines} "${logFile}"`);
    return stdout;
  } catch {
    return "";
  }
}

// ── Stats deletion ────────────────────────────────────────────────────────

export async function deleteStats(
  uuid: string,
  server?: ServerInstance,
): Promise<boolean> {
  const cfg = server?.config ?? getServerConfig();
  const deleted = await serverAccess.deleteStatsFile(cfg, uuid);
  if (deleted) {
    const { invalidateAllStatsCache } = await import("./statUtils.js");
    invalidateAllStatsCache(cfg.id);
  }
  return deleted;
}

// ── Re-exports removed — use resolveServer(interaction) from guildRouter.ts ──

// B-06: cache is keyed by server ID so multiple instances don't bleed into
// each other. The old module-level variables returned server A's output when
// server B was queried within the 500ms window.
const listOutputCache = new Map<string, { output: string; time: number }>();

export async function getListOutput(
  server?: ServerInstance,
): Promise<string | null> {
  const key = server?.id ?? "__local__";
  const now = Date.now();
  const cached = listOutputCache.get(key);
  if (cached && now - cached.time < 500) return cached.output;
  if (server) {
    await server.sendCommand("/list");
  }
  await new Promise<void>((r) => setTimeout(r, 200));
  const output = await getLatestLogs(10, undefined, server);
  listOutputCache.set(key, { output, time: now });
  return output;
}

// ── Pure helpers (no server dependency) ───────────────────────────────────

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

function findUpward(startDir: string, marker: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(path.join(dir, marker))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

export function getRootDir(): string {
  return findUpward(process.cwd(), "package.json");
}

export async function ensureDir(filePath: string): Promise<string> {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) await fsPromises.mkdir(dir, { recursive: true });
  return dir;
}

// ── JSON cache (bot-local data: links, schedule, etc.) ───────────────────

const jsonCache = new Map<string, JsonCacheEntry>();
const writeLocks = new Map<string, Promise<void>>();

export async function loadJson(file: string): Promise<unknown> {
  try {
    const { mtimeMs } = await fsPromises.stat(file);
    const cached = jsonCache.get(file);
    if (cached && cached.mtimeMs === mtimeMs) return cached.data;
    const raw = await fsPromises.readFile(file, "utf-8");
    const data: unknown = JSON.parse(raw);
    jsonCache.set(file, { mtimeMs, data });
    return data;
  } catch {
    return {};
  }
}

export async function saveJson(file: string, data: unknown): Promise<void> {
  const prev = writeLocks.get(file) ?? Promise.resolve();
  const next = prev.then(async () => {
    await ensureDir(file);
    await fsPromises.writeFile(file, JSON.stringify(data, null, 2));
    const { mtimeMs } = await fsPromises.stat(file);
    jsonCache.set(file, { mtimeMs, data });
  });
  writeLocks.set(
    file,
    next.catch(() => {}),
  );
  return next;
}
