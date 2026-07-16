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

import {
  MIN_WRAPPER_VERSION,
  compareContract,
  logContractReport,
  parseManifest,
  type WrapperManifest,
} from "./wrapperContract.js";
import { log } from "../logger.js";
import type {
  ServerConfig,
  WhitelistEntry,
  MinecraftStatsFile,
  BackupSummary,
  ScriptResult,
  ServerCapabilities,
  TpsResult,
} from "../../types/index.js";
import { allCapabilities } from "../../types/index.js";

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

/**
 * GET an instance route without asserting the status, for the few callers
 * that treat a specific one as data rather than as a failure.
 */
async function apiGetRaw(cfg: ServerConfig, route: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
  // Bug 3 fix: explicit timeout so a hung API server can't stall the poll
  // loop indefinitely. Node 18+ AbortSignal.timeout() is zero-dependency.
  return fetch(instanceUrl(cfg, route), {
    headers,
    signal: AbortSignal.timeout(8_000),
  });
}

/** Assert a wrapper response is OK and decode it. */
async function readApiJson<T>(res: Response, route: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${route} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>; // pinned first-party contract (see note above)
}

async function apiGet<T>(cfg: ServerConfig, route: string): Promise<T> {
  return readApiJson<T>(await apiGetRaw(cfg, route), route);
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
  const { output } = await apiGet<{ output: string }>(
    cfg,
    `/logs/tail?lines=${lines}`,
  );
  return output;
}

// ── Server status ────────────────────────────────────────────────────────

/** Check whether the server is running. */
export async function isRunning(cfg: ServerConfig): Promise<boolean> {
  const { running } = await apiGet<{ running: boolean }>(cfg, "/running");
  return running;
}

/** Get the current player list. */
export async function getList(
  cfg: ServerConfig,
): Promise<{ playerCount: string; maxPlayers: string; players: string[] }> {
  return apiGet(cfg, "/list");
}

/** Send a command to the server (via RCON or screen on the remote host). */
export async function sendCommand(
  cfg: ServerConfig,
  command: string,
): Promise<string | null> {
  const { result } = await apiPost<{ result: string | null }>(cfg, "/command", {
    command,
  });
  return result;
}

/** Get TPS data from the server. Returns null if unavailable. */
export async function getTps(cfg: ServerConfig): Promise<TpsResult | null> {
  const { tps } = await apiGet<{
    tps: TpsResult | null;
  }>(cfg, "/tps");
  return tps;
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

/** Read the server's whitelist. */
export async function readWhitelist(
  cfg: ServerConfig,
): Promise<WhitelistEntry[]> {
  const { whitelist } = await apiGet<{ whitelist: WhitelistEntry[] }>(
    cfg,
    "/whitelist",
  );
  return whitelist;
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

// ── Level name ────────────────────────────────────────────────────────────

/** Read level-name from server.properties. Falls back to "world". */
export async function readLevelName(cfg: ServerConfig): Promise<string> {
  const { levelName } = await apiGet<{ levelName: string }>(cfg, "/level-name");
  return levelName;
}

// ── Player stats ──────────────────────────────────────────────────────────

/** Load a single player's stats JSON. Returns null if not found. */
export async function readStats(
  cfg: ServerConfig,
  uuid: string,
): Promise<MinecraftStatsFile | null> {
  assertUuidFormat(uuid); // guard the path/route sink
  // A player with no stats file is a normal answer, not a failure: they have
  // simply never played here, and the wrapper says 404. Letting that throw
  // surfaced as "Failed to retrieve stats" (and an ERROR log) instead of the
  // "Stats File Not Found" reply the caller already handles. A 500 still
  // throws — "the read broke" must not look like "this player has none".
  const res = await apiGetRaw(cfg, `/stats/${uuid}`);
  if (res.status === 404) return null;
  const { stats } = await readApiJson<{ stats: MinecraftStatsFile | null }>(
    res,
    `/stats/${uuid}`,
  );
  return stats;
}

/** List all UUIDs that have a stats file on this server. */
export async function listStatsUuids(cfg: ServerConfig): Promise<string[]> {
  const { uuids } = await apiGet<{ uuids: string[] }>(cfg, "/stats");
  return uuids;
}

/** Delete a player's stats file via the wrapper. */
export async function deleteStatsFile(
  cfg: ServerConfig,
  uuid: string,
): Promise<boolean> {
  assertUuidFormat(uuid); // guard the path/route sink
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

// ── Mod list ──────────────────────────────────────────────────────────────

/**
 * Return the raw mod slugs and the mtime of downloaded_versions.json.
 * The caller (modUtils.ts) handles the Modrinth lookup and caching —
 * that logic is the same regardless of local/remote.
 */
export async function readModSlugs(
  cfg: ServerConfig,
): Promise<{ slugs: string[]; mtimeMs: number }> {
  return apiGet<{ slugs: string[]; mtimeMs: number }>(cfg, "/mods");
}

// ── Backups ───────────────────────────────────────────────────────────────

/** Scan the backup directories for a server. */
export async function readBackups(cfg: ServerConfig): Promise<BackupSummary> {
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
  try {
    return await apiGet<ServerCapabilities>(cfg, "/capabilities");
  } catch {
    return allCapabilities();
  }
}

// ── Script execution ──────────────────────────────────────────────────────

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
  return apiPost<ScriptResult>(cfg, "/scripts/run", { action, args });
}

// ── Log streaming (SSE URL, used by RemoteLogWatcher) ────────────────────

/** Returns the SSE endpoint URL for a remote instance's log stream. */
export function logStreamUrl(cfg: ServerConfig): string {
  if (!cfg.apiUrl)
    throw new Error(`logStreamUrl called on local instance '${cfg.id}'`);
  return `${cfg.apiUrl.replace(/\/$/, "")}/instances/${cfg.id}/logs/stream`;
}
