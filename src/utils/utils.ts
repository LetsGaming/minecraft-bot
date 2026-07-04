import { promises as fsPromises, existsSync } from "fs";
import path from "path";
import type { JsonCacheEntry, WhitelistEntry } from "../types/index.js";
import type { ServerInstance } from "./server.js";
import * as serverAccess from "./serverAccess.js";
import { log } from "./logger.js";

// ── Whitelist ─────────────────────────────────────────────────────────────

// Per-server cache keyed by server ID so multi-instance setups don't bleed.
// Entries carry a timestamp and expire after WHITELIST_CACHE_TTL_MS as
// a safety net for whitelist edits made outside the bot (in-game
// `/whitelist add`, manual file edits). Bot-initiated edits additionally
// call invalidateWhitelistCache() directly for immediate consistency.
const WHITELIST_CACHE_TTL_MS = 60_000;
const whitelistCache = new Map<
  string,
  { data: WhitelistEntry[] | null; at: number }
>();

/**
 * Load the whitelist for the given server.
 * Routes through serverAccess so remote servers fetch from the API wrapper.
 */
export async function loadWhitelist(
  forceReload = false,
  server: ServerInstance,
): Promise<WhitelistEntry[] | null> {
  const cfg = server.config;
  const key = cfg.id;

  const cached = whitelistCache.get(key);
  if (
    !forceReload &&
    cached &&
    Date.now() - cached.at < WHITELIST_CACHE_TTL_MS
  )
    return cached.data;

  const data = await serverAccess.readWhitelist(cfg);
  const result = data.length > 0 ? data : null;
  whitelistCache.set(key, { data: result, at: Date.now() });
  return result;
}

export function invalidateWhitelistCache(serverId?: string): void {
  if (serverId) {
    whitelistCache.delete(serverId);
    userCacheCache.delete(serverId);
  } else {
    whitelistCache.clear();
    userCacheCache.clear();
  }
}

// ── Known players (whitelist + usercache) ─────────────────────────────────

// usercache.json covers every player the server has ever seen, so name
// resolution keeps working on servers that run without a whitelist. Same
// TTL and invalidation as the whitelist cache.
const userCacheCache = new Map<string, { data: WhitelistEntry[]; at: number }>();

async function loadUserCache(server: ServerInstance): Promise<WhitelistEntry[]> {
  const key = server.config.id;
  const cached = userCacheCache.get(key);
  if (cached && Date.now() - cached.at < WHITELIST_CACHE_TTL_MS) {
    return cached.data;
  }
  const data = await serverAccess.readUserCache(server.config);
  userCacheCache.set(key, { data, at: Date.now() });
  return data;
}

/**
 * Every player the bot can put a name to: the whitelist plus usercache.json.
 *
 * Whitelist entries come first and win name conflicts (they are the
 * admin-managed canonical list); usercache fills in everyone else, most
 * recently seen first. On servers without a whitelist this is simply the
 * usercache, so stats, leaderboards, and autocomplete keep working.
 */
export async function loadKnownPlayers(
  forceReload = false,
  server: ServerInstance,
): Promise<WhitelistEntry[]> {
  const [whitelist, usercache] = await Promise.all([
    loadWhitelist(forceReload, server),
    forceReload
      ? serverAccess
          .readUserCache(server.config)
          .then((data) => {
            userCacheCache.set(server.config.id, { data, at: Date.now() });
            return data;
          })
      : loadUserCache(server),
  ]);

  const known: WhitelistEntry[] = [...(whitelist ?? [])];
  const seen = new Set(known.map((p) => p.uuid));

  // usercache.json appends as players join, so iterate newest first.
  for (let i = usercache.length - 1; i >= 0; i--) {
    const entry = usercache[i]!;
    if (seen.has(entry.uuid)) continue;
    seen.add(entry.uuid);
    known.push(entry);
  }
  return known;
}

// ── Level name ────────────────────────────────────────────────────────────

const levelNameCache = new Map<string, string>();

export async function getLevelName(server: ServerInstance): Promise<string> {
  const cfg = server.config;
  const key = cfg.id;
  if (levelNameCache.has(key)) return levelNameCache.get(key)!;
  const name = await serverAccess.readLevelName(cfg);
  levelNameCache.set(key, name);
  return name;
}

// ── Log tailing ───────────────────────────────────────────────────────────

/**
 * Return the last N lines of latest.log for the given server.
 * Routes through serverAccess so remote servers are handled transparently.
 */
export async function getLatestLogs(
  lines = 10,
  server: ServerInstance,
): Promise<string> {
  return serverAccess.tailLog(server.config, lines);
}

// ── Stats deletion ────────────────────────────────────────────────────────

export async function deleteStats(
  uuid: string,
  server: ServerInstance,
): Promise<boolean> {
  const cfg = server.config;
  const deleted = await serverAccess.deleteStatsFile(cfg, uuid);
  if (deleted) {
    const { invalidateAllStatsCache } = await import("./statUtils.js");
    invalidateAllStatsCache(cfg.id);
  }
  return deleted;
}

// ── Re-exports removed — use resolveServer(interaction) from guildRouter.ts ──

// Cache is keyed by server ID so multiple instances don't bleed into
// each other. The old module-level variables returned server A's output when
// server B was queried within the 500ms window.
const listOutputCache = new Map<string, { output: string; time: number }>();

export async function getListOutput(
  server?: ServerInstance,
): Promise<string | null> {
  if (!server) return null;
  const key = server.id;
  const now = Date.now();
  const cached = listOutputCache.get(key);
  if (cached && now - cached.time < 500) return cached.output;
  await server.sendCommand("/list");
  for (let i = 0; i < 3; i++) {
    await new Promise<void>((r) => setTimeout(r, 300));
    const output = await getLatestLogs(10, server);
    if (output.includes("players online")) {
      listOutputCache.set(key, { output, time: now });
      return output;
    }
  }
  return null;
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

function isEnoent(err: unknown): boolean {
  return (
    err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/**
 * Load a bot-local JSON store.
 *
 * A missing file just means "first run" and yields an empty store. Anything
 * else (truncated file, bad permissions, corrupt JSON) must not be turned
 * into `{}` — the next save would overwrite what's left on disk and make
 * the loss permanent. So: log, try the `.bak` copy, throw if that fails too.
 */
export async function loadJson(file: string): Promise<unknown> {
  try {
    const { mtimeMs } = await fsPromises.stat(file);
    const cached = jsonCache.get(file);
    if (cached && cached.mtimeMs === mtimeMs) return cached.data;
    const raw = await fsPromises.readFile(file, "utf-8");
    const data: unknown = JSON.parse(raw);
    jsonCache.set(file, { mtimeMs, data });
    return data;
  } catch (err) {
    if (isEnoent(err)) return {};

    const reason = err instanceof Error ? err.message : String(err);
    const base = path.basename(file);
    log.error(
      "storage",
      `Failed to read ${file}: ${reason} — attempting recovery from ${base}.bak`,
    );

    try {
      const raw = await fsPromises.readFile(`${file}.bak`, "utf-8");
      const data: unknown = JSON.parse(raw);
      log.warn(
        "storage",
        `Recovered ${base} from last-known-good backup; the next save will repair the main file.`,
      );
      // Not cached: the main file's mtime still identifies the corrupt
      // content. The next save rewrites the file and refreshes the cache.
      return data;
    } catch {
      throw new Error(
        `${file} is corrupt or unreadable (${reason}) and no usable .bak ` +
          `backup exists. Refusing to continue with empty data — restore ` +
          `the file from a backup, or delete it (and its .bak) to ` +
          `intentionally start fresh.`,
      );
    }
  }
}

export async function saveJson(file: string, data: unknown): Promise<void> {
  const prev = writeLocks.get(file) ?? Promise.resolve();
  const next = prev.then(async () => {
    await ensureDir(file);
    const json = JSON.stringify(data, null, 2);

    // Write-then-rename: an interrupted in-place write leaves a truncated
    // file, while rename(2) is atomic — readers see old or new, never half.
    const tmp = `${file}.tmp`;
    await fsPromises.writeFile(tmp, json);
    await fsPromises.rename(tmp, file);

    const { mtimeMs } = await fsPromises.stat(file);
    jsonCache.set(file, { mtimeMs, data });

    // Last-known-good copy for loadJson's recovery path, same tmp+rename
    // dance. Best-effort — a failed backup must not fail the save.
    try {
      const bakTmp = `${file}.bak.tmp`;
      await fsPromises.writeFile(bakTmp, json);
      await fsPromises.rename(bakTmp, `${file}.bak`);
    } catch (bakErr) {
      const reason =
        bakErr instanceof Error ? bakErr.message : String(bakErr);
      log.warn(
        "storage",
        `Could not write backup for ${path.basename(file)}: ${reason}`,
      );
    }
  });
  writeLocks.set(
    file,
    next.catch(() => {}),
  );
  return next;
}
