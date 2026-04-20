/**
 * serverAccess.ts
 *
 * Single routing layer for every operation that requires either local
 * filesystem / shell access OR a call to the remote API wrapper.
 *
 * Rule: if server.config.apiUrl is set → HTTP call to the API wrapper.
 *       Otherwise → exact same local logic that always existed.
 *
 * Callers never import fs, path, spawn, or execCommand directly for
 * server-specific data. They import and call these functions instead.
 *
 * Functions are intentionally thin — they do no business logic beyond
 * routing and returning the raw data the caller needs.
 */

import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import {
  isSudoPermissionError,
  sudoHelpMessage,
} from "../shell/execCommand.js";
import type {
  ServerConfig,
  WhitelistEntry,
  MinecraftStatsFile,
  BackupDirInfo,
  BackupSummary,
  ScriptResult,
} from "../types/index.js";

const execAsync = promisify(exec);

// ── API helper ────────────────────────────────────────────────────────────

async function apiGet<T>(cfg: ServerConfig, route: string): Promise<T> {
  const url = `${cfg.apiUrl!.replace(/\/$/, "")}/instances/${cfg.id}${route}`;
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
  return res.json() as Promise<T>;
}

async function apiPost<T>(
  cfg: ServerConfig,
  route: string,
  body: unknown,
): Promise<T> {
  const url = `${cfg.apiUrl!.replace(/\/$/, "")}/instances/${cfg.id}${route}`;
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
  return res.json() as Promise<T>;
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
    const { stdout } = await execAsync(`tail -n ${lines} "${logFile}"`);
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
): Promise<import("../types/index.js").TpsResult | null> {
  if (cfg.apiUrl) {
    const { tps } = await apiGet<{
      tps: import("../types/index.js").TpsResult | null;
    }>(cfg, "/tps");
    return tps;
  }
  return null;
}

// ── Whitelist ─────────────────────────────────────────────────────────────

/** Read whitelist.json for the given server. Returns [] on any error. */
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
    return Array.isArray(data) ? (data as WhitelistEntry[]) : [];
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

/** Return the stats directory path (local only — used for cache keys). */
export async function statsDir(cfg: ServerConfig): Promise<string> {
  const levelName = await readLevelName(cfg);
  return path.resolve(cfg.serverDir, levelName, "stats");
}

/** Load a single player's stats JSON. Returns null if not found. */
export async function readStats(
  cfg: ServerConfig,
  uuid: string,
): Promise<MinecraftStatsFile | null> {
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
  if (cfg.apiUrl) {
    // Remote stats files are managed by the API server VM.
    // Deletion from the bot side is intentionally not supported.
    return false;
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

// ── Script execution ──────────────────────────────────────────────────────

const SCRIPT_MAP: Record<string, string> = {
  start: "start.sh",
  stop: "shutdown.sh",
  restart: "smart_restart.sh",
  backup: "backup/backup.sh",
  status: "misc/status.sh",
};

const SCRIPT_TIMEOUTS: Record<string, number> = {
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

  const scriptRelPath = SCRIPT_MAP[action];
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

  const timeoutMs = SCRIPT_TIMEOUTS[action] ?? 120_000;

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
