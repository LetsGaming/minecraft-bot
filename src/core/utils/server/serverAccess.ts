/**
 * serverAccess.ts
 *
 * Single routing layer for every operation that requires either local
 * filesystem / shell access OR a call to the remote API wrapper.
 *
 * Rule: if server.config.apiUrl is set → HTTP call to the API wrapper.
 *       Otherwise → exact same local logic that always existed.
 *
 * Callers never import fs, path, spawn, or execFile directly for
 * server-specific data. They import and call these functions instead.
 *
 * Functions are intentionally thin — they do no business logic beyond
 * routing and returning the raw data the caller needs.
 */

import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { isRecord } from "../objects.js";
import {
  MIN_WRAPPER_VERSION,
  compareContract,
  logContractReport,
  parseManifest,
  type WrapperManifest,
} from "./wrapperContract.js";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { log } from "../logger.js";
import {
  isSudoPermissionError,
  sudoHelpMessage,
} from "../../shell/execCommand.js";
import type {
  ServerConfig,
  WhitelistEntry,
  MinecraftStatsFile,
  BackupDirInfo,
  BackupSummary,
  ScriptResult,
  ServerCapabilities,
  TpsResult,
} from "../../types/index.js";
import { allCapabilities } from "../../types/index.js";
import type { ServerScriptAction } from "@mcbot/schema/serverActions.js";

const execFileAsync = promisify(execFile);

// ── UUID sink guard ───────────────────────────────────────────────────────

/**
 * Defense-in-depth at the sink: every UUID used here currently comes from
 * Mojang or the server's own files, but assert the shape right before any
 * `path.join`/URL interpolation anyway so a future caller can't introduce
 * path traversal.
 */
const UUID_FORMAT = /^[0-9a-fA-F-]{32,36}$/;

function assertUuidFormat(uuid: string): void {
  if (!UUID_FORMAT.test(uuid)) {
    throw new Error(
      `Invalid UUID format: ${JSON.stringify(String(uuid).slice(0, 64))}`,
    );
  }
}

// ── API helper ────────────────────────────────────────────────────────────

// apiGet/apiPost/apiDelete talk to *our own* server wrapper, whose response
// shapes are a versioned contract enforced at connect time by
// verifyWrapperVersion() (see MIN_WRAPPER_VERSION). Casting the JSON to the
// caller-specified T is therefore asserting a pinned first-party contract, not
// blindly trusting arbitrary third-party JSON — a wrapper that changed a field
// would fail the version gate, not silently mis-shape a response here.
/** A wrapper-level route: /health, /manifest, /instances. */
function wrapperUrl(cfg: ServerConfig, route: string): string {
  return `${cfg.apiUrl!.replace(/\/$/, "")}${route}`;
}

/** A route scoped to this instance — everything under /instances/:id. */
function instanceUrl(cfg: ServerConfig, route: string): string {
  return wrapperUrl(cfg, `/instances/${cfg.id}${route}`);
}

async function apiGet<T>(cfg: ServerConfig, route: string): Promise<T> {
  const url = instanceUrl(cfg, route);
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
  // Bug 3 fix: explicit timeout so a hung API server can't stall the poll
  // loop indefinitely. Node 18+ AbortSignal.timeout() is zero-dependency.
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${route} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>; // pinned first-party contract (see note above)
}

async function apiPost<T>(
  cfg: ServerConfig,
  route: string,
  body: unknown,
): Promise<T> {
  const url = instanceUrl(cfg, route);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
  // Bug 3 fix: explicit timeout (script endpoints have longer operations,
  // but 30 s is still a sane ceiling for any single HTTP call).
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API POST ${route} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>; // pinned first-party contract (see apiGet)
}

// ── Log tailing ───────────────────────────────────────────────────────────

/**
 * Return the last N lines of the server's latest.log.
 * Used as a fallback for seed/coord parsing and screen-mode getList.
 */
export async function tailLog(cfg: ServerConfig, lines = 10): Promise<string> {
  if (cfg.apiUrl) {
    const { output } = await apiGet<{ output: string }>(
      cfg,
      `/logs/tail?lines=${lines}`,
    );
    return output;
  }
  const logFile = path.join(cfg.serverDir, "logs", "latest.log");
  try {
    // Use execFile (no shell) so logFile cannot inject shell metacharacters
    // even if a future refactor sources cfg.serverDir from user input.
    const { stdout } = await execFileAsync("tail", ["-n", String(lines), logFile]);
    return stdout;
  } catch {
    return "";
  }
}

// ── Server status ────────────────────────────────────────────────────────

/** Check whether the server is running. */
export async function isRunning(cfg: ServerConfig): Promise<boolean> {
  if (cfg.apiUrl) {
    const { running } = await apiGet<{ running: boolean }>(cfg, "/running");
    return running;
  }
  return false;
}

/** Get the current player list. */
export async function getList(
  cfg: ServerConfig,
): Promise<{ playerCount: string; maxPlayers: string; players: string[] }> {
  if (cfg.apiUrl) {
    return apiGet(cfg, "/list");
  }
  return { playerCount: "0", maxPlayers: "?", players: [] };
}

/** Send a command to the server (via RCON or screen on the remote host). */
export async function sendCommand(
  cfg: ServerConfig,
  command: string,
): Promise<string | null> {
  if (cfg.apiUrl) {
    const { result } = await apiPost<{ result: string | null }>(
      cfg,
      "/command",
      { command },
    );
    return result;
  }
  return null;
}

/** Get TPS data from the server. Returns null if unavailable. */
export async function getTps(
  cfg: ServerConfig,
): Promise<TpsResult | null> {
  if (cfg.apiUrl) {
    const { tps } = await apiGet<{
      tps: TpsResult | null;
    }>(cfg, "/tps");
    return tps;
  }
  return null;
}

async function apiDelete<T>(cfg: ServerConfig, route: string): Promise<T> {
  const url = instanceUrl(cfg, route);
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
  const res = await fetch(url, {
    method: "DELETE",
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API DELETE ${route} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>; // pinned first-party contract (see apiGet)
}

// ── Wrapper /info: version handshake + remote host metrics ───────────────

// The expected-feature table, the manifest parser, and the report live in
// wrapperContract.ts; re-exported here so the wrapper contract still has
// one entry point for callers.
export {
  MIN_WRAPPER_VERSION,
  EXPECTED_WRAPPER_FEATURES,
  SUPPORTED_MANIFEST_VERSION,
  compareContract,
  describeContract,
  contractIsClean,
  parseManifest,
  type WrapperManifest,
  type ContractReport,
} from "./wrapperContract.js";

export interface RemoteHostInfo {
  process?: {
    pid: number;
    cpuPercent: number;
    rssBytes: number;
  } | null;
  disks?: Array<{
    path: string;
    usedPercent: number;
    availableBytes: number;
    totalBytes: number;
  }>;
}

export interface RemoteInfo {
  /** Wrapper semver, present from wrapper >= 1.2.0. */
  version?: string;
  /** Process RAM/CPU + disk usage of the wrapper's host, same release. */
  host?: RemoteHostInfo;
}

/**
 * Fetch the wrapper's `/info` for a remote instance. Returns null when
 * the wrapper predates the endpoint (404) or is unreachable — callers
 * treat null as "older wrapper, feature unavailable", never as an error.
 */
export async function getRemoteInfo(
  cfg: ServerConfig,
): Promise<RemoteInfo | null> {
  if (!cfg.apiUrl) return null;
  try {
    const info = await apiGet<RemoteInfo>(cfg, "/info");
    return typeof info === "object" && info !== null ? info : null;
  } catch {
    return null;
  }
}

/** "1.10.2" >= "1.2.0"? Plain numeric segment compare, no prerelease. */
export function versionAtLeast(actual: string, minimum: string): boolean {
  const a = actual.split(".").map((n) => parseInt(n, 10) || 0);
  const b = minimum.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv;
  }
  return true;
}

/**
 * Fetch the wrapper's feature manifest, or null when it predates the
 * endpoint (404), is unreachable, or answers something unparseable.
 *
 * Deliberately not `apiGet<WrapperManifest>`: every other wrapper
 * response is cast to its type because the version gate pins the
 * contract, but this endpoint *is* the gate. Trusting its shape would
 * assume what it exists to establish, so it goes through parseManifest.
 */
export async function getRemoteManifest(
  cfg: ServerConfig,
): Promise<WrapperManifest | null> {
  if (!cfg.apiUrl) return null;
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
  try {
    const res = await fetch(wrapperUrl(cfg, "/manifest"), {
      headers,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null; // 404 on wrappers that predate the endpoint
    return parseManifest(await res.json());
  } catch {
    return null;
  }
}

/**
 * Report, at startup, where a remote instance's wrapper and this bot
 * disagree about what exists. Never throws — a mismatched wrapper
 * degrades features, it must not stop the bot.
 *
 * Preferred path is the manifest, which names the individual features.
 * Wrappers older than that get the coarse version compare they were
 * built for.
 */
export async function verifyWrapperContract(
  cfg: ServerConfig,
  botVersion: string,
): Promise<void> {
  if (!cfg.apiUrl) return;

  const manifest = await getRemoteManifest(cfg);
  if (manifest) {
    logContractReport(cfg.id, manifest, compareContract(manifest), botVersion);
    return;
  }

  // ── Fallback: no manifest, so all we have is /info's version.
  const info = await getRemoteInfo(cfg);
  if (!info || !info.version) {
    log.warn(
      cfg.id,
      `API wrapper reports neither a manifest nor a version (both /manifest ` +
        `and /info missing — wrapper predates ${MIN_WRAPPER_VERSION}). Remote ` +
        `host metrics, usercache names, and capability gating are ` +
        `unavailable until the wrapper is updated.`,
    );
    return;
  }
  if (!versionAtLeast(info.version, MIN_WRAPPER_VERSION)) {
    log.warn(
      cfg.id,
      `API wrapper ${info.version} is older than the expected ` +
        `${MIN_WRAPPER_VERSION} — some remote features may silently degrade. ` +
        `Update the wrapper on the server host.`,
    );
    return;
  }
  log.warn(
    cfg.id,
    `API wrapper ${info.version} does not publish /manifest, so this bot ` +
      `cannot check which remote features are available — a missing one will ` +
      `only show up as a feature quietly doing nothing. Update the wrapper.`,
  );
}

// ── Whitelist ─────────────────────────────────────────────────────────────

/** Read whitelist.json for the given server. Returns [] on any error. */
/**
 * Narrow an unknown value parsed from whitelist.json / usercache.json to
 * WhitelistEntry[]. Anything without a string `name` and `uuid` is dropped, so
 * a malformed file yields fewer entries — never a wrongly-typed one that would
 * blow up downstream. This is the single checked reader for both files.
 */
function toWhitelistEntries(data: unknown): WhitelistEntry[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((e) => {
    if (!isRecord(e)) return [];
    const { name, uuid } = e;
    return typeof name === "string" && typeof uuid === "string"
      ? [{ name, uuid }]
      : [];
  });
}

export async function readWhitelist(
  cfg: ServerConfig,
): Promise<WhitelistEntry[]> {
  if (cfg.apiUrl) {
    const { whitelist } = await apiGet<{ whitelist: WhitelistEntry[] }>(
      cfg,
      "/whitelist",
    );
    return whitelist;
  }
  try {
    const raw = await fsPromises.readFile(
      path.resolve(cfg.serverDir, "whitelist.json"),
      "utf-8",
    );
    const data: unknown = JSON.parse(raw);
    return toWhitelistEntries(data);
  } catch {
    return [];
  }
}

/**
 * Read usercache.json (every player the server has ever seen, whitelist or
 * not). Returns [] on any error, including remote wrappers that predate the
 * /usercache endpoint — callers treat the cache as a best-effort name
 * source on top of the whitelist.
 */
export async function readUserCache(
  cfg: ServerConfig,
): Promise<WhitelistEntry[]> {
  if (cfg.apiUrl) {
    try {
      const { usercache } = await apiGet<{ usercache: WhitelistEntry[] }>(
        cfg,
        "/usercache",
      );
      return Array.isArray(usercache) ? usercache : [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.debug("serverAccess", `usercache unavailable for ${cfg.id}: ${msg}`);
      return [];
    }
  }
  try {
    const raw = await fsPromises.readFile(
      path.resolve(cfg.serverDir, "usercache.json"),
      "utf-8",
    );
    const data: unknown = JSON.parse(raw);
    return toWhitelistEntries(data);
  } catch {
    return [];
  }
}

// ── Level name ────────────────────────────────────────────────────────────

/** Read level-name from server.properties. Falls back to "world". */
export async function readLevelName(cfg: ServerConfig): Promise<string> {
  if (cfg.apiUrl) {
    const { levelName } = await apiGet<{ levelName: string }>(
      cfg,
      "/level-name",
    );
    return levelName;
  }
  try {
    const text = await fsPromises.readFile(
      path.resolve(cfg.serverDir, "server.properties"),
      "utf-8",
    );
    const m = text.match(/^level-name\s*=\s*(.+)$/m);
    return m?.[1]?.trim() ?? "world";
  } catch {
    return "world";
  }
}

// ── Player stats ──────────────────────────────────────────────────────────

/**
 * Layouts a world may keep player stat files in, in order. Vanilla first —
 * it is the documented default and what an unmodded server writes.
 */
const STATS_DIR_CANDIDATES = ["stats", path.join("players", "stats")];

/**
 * Return the stats directory for a local instance (also the cache key).
 *
 * This hardcoded `<level>/stats` until a Fabric server in the field turned
 * out to keep its stats at `<level>/players/stats`, next to
 * `players/advancements`, with no `<level>/stats` at all.
 *
 * Probing matters because the failure mode is silence: on the wrong path
 * every read is an ENOENT, which is exactly what a world nobody has played
 * on looks like. Stats read as empty, leaderboards go blank, and nothing
 * anywhere reports an error.
 */
export async function statsDir(cfg: ServerConfig): Promise<string> {
  const levelName = await readLevelName(cfg);
  const base = path.resolve(cfg.serverDir, levelName);

  for (const rel of STATS_DIR_CANDIDATES) {
    const dir = path.join(base, rel);
    try {
      if ((await fsPromises.stat(dir)).isDirectory()) return dir;
    } catch {
      continue; // next candidate
    }
  }
  // None exist yet — normal on a fresh world; the server creates one when
  // somebody first plays. Name the vanilla path so errors point at the
  // expected location, and do not cache the miss.
  return path.join(base, STATS_DIR_CANDIDATES[0]!);
}

/** Load a single player's stats JSON. Returns null if not found. */
export async function readStats(
  cfg: ServerConfig,
  uuid: string,
): Promise<MinecraftStatsFile | null> {
  assertUuidFormat(uuid); // guard the path/route sink
  if (cfg.apiUrl) {
    const { stats } = await apiGet<{ stats: MinecraftStatsFile | null }>(
      cfg,
      `/stats/${uuid}`,
    );
    return stats;
  }
  const dir = await statsDir(cfg);
  const filePath = path.join(dir, `${uuid}.json`);
  try {
    const raw = await fsPromises.readFile(filePath, "utf-8");
    // MinecraftStatsFile is an open Minecraft-authored shape (flat *or* nested,
    // thousands of possible stat keys). Every downstream reader in statUtils
    // walks it defensively (guards each access, tolerates missing keys), so a
    // structural check here would add no safety — the consumer already assumes
    // nothing about the shape. We deliberately keep the cast for that reason.
    return JSON.parse(raw) as MinecraftStatsFile;
  } catch {
    return null;
  }
}

/** List all UUIDs that have a stats file on this server. */
export async function listStatsUuids(cfg: ServerConfig): Promise<string[]> {
  if (cfg.apiUrl) {
    const { uuids } = await apiGet<{ uuids: string[] }>(cfg, "/stats");
    return uuids;
  }
  const dir = await statsDir(cfg);
  try {
    const files = await fsPromises.readdir(dir);
    return files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
}

/** Delete a stats file (local only — remote deletion is not exposed). */
export async function deleteStatsFile(
  cfg: ServerConfig,
  uuid: string,
): Promise<boolean> {
  assertUuidFormat(uuid); // guard the path/route sink
  if (cfg.apiUrl) {
    // The wrapper exposes DELETE /stats/:uuid so the
    // admin-gated /server prune-stats works on remote instances too.
    // Older wrappers without the route (or any transport error) degrade
    // to "not deleted" — prune-stats then reports 0 deletions instead of
    // failing the whole command.
    try {
      const { deleted } = await apiDelete<{ deleted: boolean }>(
        cfg,
        `/stats/${encodeURIComponent(uuid)}`,
      );
      return deleted === true;
    } catch {
      return false;
    }
  }
  const dir = await statsDir(cfg);
  try {
    await fsPromises.rm(path.join(dir, `${uuid}.json`));
    return true;
  } catch {
    return false;
  }
}

// ── Mod list ──────────────────────────────────────────────────────────────

/**
 * Return the raw mod slugs and the mtime of downloaded_versions.json.
 * The caller (modUtils.ts) handles the Modrinth lookup and caching —
 * that logic is the same regardless of local/remote.
 */
export async function readModSlugs(
  cfg: ServerConfig,
): Promise<{ slugs: string[]; mtimeMs: number }> {
  if (cfg.apiUrl) {
    return apiGet<{ slugs: string[]; mtimeMs: number }>(cfg, "/mods");
  }
  const jsonPath = path.join(
    cfg.scriptDir,
    "common",
    "downloaded_versions.json",
  );
  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      `downloaded_versions.json not found at ${jsonPath}.\n` +
        "Make sure scriptDir is correctly configured for this server.",
    );
  }
  const stat = fs.statSync(jsonPath);
  const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as {
    mods?: Record<string, unknown>;
  };
  return { slugs: Object.keys(raw.mods ?? {}), mtimeMs: stat.mtimeMs };
}

// ── Backups ───────────────────────────────────────────────────────────────

/** Scan the backup directories for a server. */
export async function readBackups(cfg: ServerConfig): Promise<BackupSummary> {
  if (cfg.apiUrl) {
    const data = await apiGet<{
      dirs: Array<{
        dir: string;
        count: number;
        latestFile: string;
        latestMtimeMs: number;
        latestSizeBytes: number;
      }>;
      totalBytes: number;
    }>(cfg, "/backups");
    return {
      dirs: data.dirs.map((d) => ({
        ...d,
        latestMtime: new Date(d.latestMtimeMs),
      })),
      totalBytes: data.totalBytes,
    };
  }

  const backupsBase = path.resolve(
    cfg.serverDir,
    "..",
    "backups",
    cfg.screenSession,
  );
  const subdirs = [
    "hourly",
    "archives/daily",
    "archives/weekly",
    "archives/monthly",
    "archives/update",
  ];
  const dirs: BackupDirInfo[] = [];
  let totalBytes = 0;

  for (const dir of subdirs) {
    const fullDir = path.join(backupsBase, dir);
    if (!fs.existsSync(fullDir)) continue;
    const files = fs
      .readdirSync(fullDir)
      .filter((f) => f.endsWith(".tar.zst") || f.endsWith(".tar.gz"));
    if (files.length === 0) continue;
    files.sort().reverse();
    const latest = files[0]!;
    const stat = fs.statSync(path.join(fullDir, latest));
    totalBytes += stat.size;
    dirs.push({
      dir,
      count: files.length,
      latestFile: latest,
      latestMtime: stat.mtime,
      latestSizeBytes: stat.size,
    });
  }

  return { dirs, totalBytes };
}

// ── Capability detection ───────────────────────────────────────────

/**
 * Probe which setup-suite artifacts exist for a server.
 *
 * Local instances: cheap fs.existsSync probes against the documented suite
 * layout (management scripts, backup directories, mod manifest,
 * variables.txt).
 *
 * Remote instances: GET /instances/:id/capabilities on the API wrapper.
 * Older wrappers don't have that route, so any failure falls back to the
 * conservative all-true default — behaviour is then exactly as before
 * capability detection existed (errors surface at invocation time).
 */
export async function detectCapabilities(
  cfg: ServerConfig,
): Promise<ServerCapabilities> {
  if (cfg.apiUrl) {
    try {
      return await apiGet<ServerCapabilities>(cfg, "/capabilities");
    } catch {
      return allCapabilities();
    }
  }

  const scriptExists = (rel: string): boolean =>
    !!cfg.scriptDir && fs.existsSync(path.join(cfg.scriptDir, rel));

  const backupsBase = cfg.serverDir
    ? path.resolve(cfg.serverDir, "..", "backups", cfg.screenSession)
    : "";

  return {
    scripts: {
      start: scriptExists(SCRIPT_MAP.start),
      stop: scriptExists(SCRIPT_MAP.stop),
      restart: scriptExists(SCRIPT_MAP.restart),
      backup: scriptExists(SCRIPT_MAP.backup),
      status: scriptExists(SCRIPT_MAP.status),
    },
    backups: !!backupsBase && fs.existsSync(backupsBase),
    modManifest: scriptExists(path.join("common", "downloaded_versions.json")),
    variablesFile: scriptExists(path.join("common", "variables.txt")),
  };
}

// ── Script execution ──────────────────────────────────────────────────────

const SCRIPT_MAP: Record<ServerScriptAction, string> = {
  start: "start.sh",
  stop: "shutdown.sh",
  restart: "smart_restart.sh",
  backup: "backup/backup.sh",
  status: "misc/status.sh",
};

/** Ceiling for a script the table below doesn't name. */
const DEFAULT_SCRIPT_TIMEOUT_MS = 120_000;

const SCRIPT_TIMEOUTS: Record<ServerScriptAction, number> = {
  start: 30_000,
  stop: 60_000,
  restart: 60_000,
  backup: 300_000,
  status: 15_000,
};

/**
 * Run a named server management script (start / stop / restart / backup / status).
 * On remote instances this POSTs to the API wrapper; locally it spawns the script
 * exactly as before.
 */
export async function runScript(
  cfg: ServerConfig,
  action: string,
  args: string[] = [],
): Promise<ScriptResult> {
  if (cfg.apiUrl) {
    return apiPost<ScriptResult>(cfg, "/scripts/run", { action, args });
  }

  const scriptRelPath = SCRIPT_MAP[action as ServerScriptAction] as
    | string
    | undefined;
  if (!scriptRelPath) throw new Error(`Unknown script action: ${action}`);

  const { scriptDir } = cfg;
  if (!scriptDir) {
    throw new Error(
      "No scriptDir configured for this server.\n" +
        "Set `scriptDir` in config.json or ensure the standard layout exists:\n" +
        "`{serverDir}/../scripts/{instanceName}/`",
    );
  }

  const scriptPath = path.join(scriptDir, scriptRelPath);
  if (!fs.existsSync(scriptPath))
    throw new Error(`Script not found: ${scriptPath}`);

  const timeoutMs =
    (SCRIPT_TIMEOUTS[action as ServerScriptAction] as number | undefined) ??
    DEFAULT_SCRIPT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const child = spawn(
      "sudo",
      ["-n", "-u", cfg.linuxUser, "bash", scriptPath, ...args],
      {
        cwd: scriptDir,
        env: { ...process.env, HOME: `/home/${cfg.linuxUser}` },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGTERM");
      reject(
        new Error(
          `Script timed out after ${timeoutMs / 1000}s\n\nOutput:\n${stdout.slice(-500)}`,
        ),
      );
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    child.on("close", (code) => {
      if (killed) return;
      clearTimeout(timer);

      const combined = stdout + "\n" + stderr;
      if (/\[SUDO ERROR\]/i.test(combined)) {
        reject(new Error(sudoHelpMessage("systemctl", cfg.linuxUser)));
        return;
      }
      if (isSudoPermissionError(stderr)) {
        reject(new Error(sudoHelpMessage("user-switch", cfg.linuxUser)));
        return;
      }

      stderr = stderr
        .split("\n")
        .filter((l) => !l.includes("[sudo]") && !l.includes("password for"))
        .join("\n")
        .trim();

      resolve({ output: stdout.trim(), stderr, exitCode: code });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to start script: ${err.message}`));
    });
  });
}

// ── Log streaming (SSE URL, used by RemoteLogWatcher) ────────────────────

/** Returns the SSE endpoint URL for a remote instance's log stream. */
export function logStreamUrl(cfg: ServerConfig): string {
  if (!cfg.apiUrl)
    throw new Error(`logStreamUrl called on local instance '${cfg.id}'`);
  return `${cfg.apiUrl.replace(/\/$/, "")}/instances/${cfg.id}/logs/stream`;
}
