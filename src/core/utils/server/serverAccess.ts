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
  scriptTimeoutMs,
  type WrapperManifest,
} from "./wrapperContract.js";
import { log } from "../logger.js";
import { SseLineStream } from "../sseLineStream.js";
import type {
  ServerConfig,
  WhitelistEntry,
  MinecraftStatsFile,
  BackupSummary,
  BackupFileIndex,
  ScriptResult,
  ServerCapabilities,
} from "../../types/index.js";
import { allCapabilities } from "../../types/index.js";
import { ConfigAccessError, configAccessErrorFor } from "./configAccessError.js";
import type {
  BackupDeleteResult,
  ConfigFileInfo,
  InstalledMod,
  InstalledMods,
  ModAddResult,
  ModApplyResult,
  ModCompatJob,
  ModCompatMod,
  ModCompatStarted,
  ModRemoveResult,
  ModToggleResult,
  ModUpdateCheck,
  RemoteHostInfo,
  WireSchemas,
} from "@mcbot/schema/wire/index.js";
import { errMsg } from "../error.js";
import {
  wrapperUrl,
  instanceUrl,
  apiGetRaw,
  readApiJson,
  apiGet,
  apiPost,
  apiDelete,
} from "./access/apiClient.js";

export { RateLimitedError } from "./access/apiClient.js";
export { forgetGamePort, rememberGamePort, pingTarget, pingServer, getHealth, isRunning, getList, getTps } from "./access/health.js";
export { sendCommandOutcome } from "./access/commands.js";

export type {
  BackupDeleteResult,
  InstalledMod,
  InstalledMods,
  ModAddResult,
  ModApplyResult,
  ModCompatJob,
  ModCompatMod,
  ModCompatStarted,
  ModRemoveResult,
  ModToggleResult,
  ModUpdateCheck,
  RemoteHostInfo,
};

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
const advertisedScriptTimeouts = new Map<string, Record<string, number>>();

function wrapperKey(cfg: ServerConfig): string {
  return `${cfg.apiUrl}#${cfg.id}`;
}

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
    const manifest = parseManifest(await res.json());
    if (manifest?.scriptTimeoutsMs) {
      advertisedScriptTimeouts.set(
        wrapperKey(cfg),
        manifest.scriptTimeoutsMs,
      );
    }
    return manifest;
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
    log.debug("serverAccess", `usercache unavailable for ${cfg.id}: ${errMsg(err)}`);
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

/**
 * Every player's stats in one wrapper request, from a wrapper new enough to
 * serve it. Null (not thrown) on a 404 so the caller can fall back to the
 * per-uuid path without treating an older wrapper as an error — the same
 * "degrade per route" pattern every other optional feature here follows.
 */
export async function readAllStats(
  cfg: ServerConfig,
): Promise<Record<string, MinecraftStatsFile> | null> {
  const res = await apiGetRaw(cfg, "/stats/bulk");
  if (res.status === 404) return null;
  const { stats } = await readApiJson<{ stats: Record<string, MinecraftStatsFile> }>(
    res,
    "/stats/bulk",
  );
  return stats;
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

// ── Mod management (the wrapper's `mod-management` feature) ────────────────
//
// The result types come from the wrapper's generated contract
// (@mcbot/schema/wire). Casting the JSON asserts that contract, gated at
// connect time by the feature handshake, the same basis as every apiGet above.

/** The richer installed list (versions, loader, filenames) the Mods tab reads. */
export async function listInstalledMods(cfg: ServerConfig): Promise<InstalledMods> {
  return apiGet<InstalledMods>(cfg, "/mods/installed");
}

/** Install a mod. Long timeout: the wrapper downloads the jar and its deps. */
export async function addMod(
  cfg: ServerConfig,
  body: {
    slug: string;
    mcVersion?: string;
    modLoader?: string;
    /** Pin to this exact Modrinth build instead of the newest compatible one. */
    versionId?: string;
  },
): Promise<ModAddResult> {
  return apiPost<ModAddResult>(cfg, "/mods", body, 130_000);
}

/** Remove an installed mod by slug. */
export async function removeMod(
  cfg: ServerConfig,
  slug: string,
): Promise<ModRemoveResult> {
  return apiDelete<ModRemoveResult>(cfg, `/mods/${encodeURIComponent(slug)}`);
}

/** Check installed mods for updates. Longer timeout: one Modrinth call per mod. */
export async function checkModUpdates(
  cfg: ServerConfig,
  mcVersion?: string,
): Promise<ModUpdateCheck> {
  const q = mcVersion ? `?mcVersion=${encodeURIComponent(mcVersion)}` : "";
  return apiGet<ModUpdateCheck>(cfg, `/mods/updates${q}`, 130_000);
}

/**
 * Whether this wrapper can run the background compatibility check. A
 * wrapper that predates the manifest, or is unreachable, answers false so the
 * dashboard hides the control and keeps the per-installed-version check.
 */
export async function supportsModCompat(cfg: ServerConfig): Promise<boolean> {
  const manifest = await getRemoteManifest(cfg);
  return (manifest?.features?.["mod-compat"]?.version ?? 0) >= 1;
}

/**
 * Start (or join) the wrapper's job that checks every installed mod for a
 * release on `mcVersion`. One job runs per version on the wrapper, so asking
 * twice returns the same job id.
 */
export async function startModCompat(
  cfg: ServerConfig,
  mcVersion: string,
  refresh = false,
): Promise<ModCompatStarted> {
  return apiPost<ModCompatStarted>(cfg, "/mods/compat", {
    mcVersion,
    ...(refresh ? { refresh: true } : {}),
  });
}

/** Progress and result of a compatibility job; null once the wrapper forgot it (404). */
export async function getModCompat(
  cfg: ServerConfig,
  jobId: string,
): Promise<ModCompatJob | null> {
  const route = `/mods/compat/${encodeURIComponent(jobId)}`;
  const res = await apiGetRaw(cfg, route);
  if (res.status === 404) return null;
  return readApiJson<ModCompatJob>(res, route);
}

/** Apply all available updates. Long timeout: downloads every updated jar. */
export async function applyModUpdates(
  cfg: ServerConfig,
  mcVersion?: string,
): Promise<ModApplyResult> {
  return apiPost<ModApplyResult>(
    cfg,
    "/mods/updates",
    mcVersion ? { mcVersion } : {},
    610_000,
  );
}

/** Update one installed mod to its latest compatible build. */
export async function updateMod(
  cfg: ServerConfig,
  slug: string,
): Promise<ModApplyResult> {
  return apiPost<ModApplyResult>(
    cfg,
    `/mods/${encodeURIComponent(slug)}/update`,
    {},
    130_000,
  );
}

/**
 * Disable an installed mod without uninstalling it — moves its jar out of
 * mods/ so the loader stops loading it, but keeps it update-checkable.
 * Takes effect on the server's next start.
 */
export async function disableMod(
  cfg: ServerConfig,
  slug: string,
): Promise<ModToggleResult> {
  return apiPost<ModToggleResult>(
    cfg,
    `/mods/${encodeURIComponent(slug)}/disable`,
    {},
  );
}

/** Re-enable a previously disabled mod. Takes effect on the server's next start. */
export async function enableMod(
  cfg: ServerConfig,
  slug: string,
): Promise<ModToggleResult> {
  return apiPost<ModToggleResult>(
    cfg,
    `/mods/${encodeURIComponent(slug)}/enable`,
    {},
  );
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

/**
 * One page of the archive index (wrapper >= 3.3.0).
 *
 * The `id` on each entry is an opaque handle. It is the only file reference
 * this client ever sends back, and the wrapper resolves it against a listing
 * it builds itself — so no caller, here or in the browser, is ever in a
 * position to name a path.
 */
export async function indexBackupFiles(
  cfg: ServerConfig,
  opts: { cursor?: string; limit?: number } = {},
): Promise<BackupFileIndex> {
  const params = new URLSearchParams();
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  const query = params.toString();
  return apiGet<BackupFileIndex>(
    cfg,
    `/backups/files${query ? `?${query}` : ""}`,
  );
}

const BACKUP_DOWNLOAD_HEADERS_TIMEOUT_MS = 30_000;
const BACKUP_DELETE_TIMEOUT_MS = 30_000;
/** The wrapper's restore ceiling (600 s) plus a margin for its own error reply. */
const RESTORE_TIMEOUT_MS = 630_000;
/** Margin added to a script's ceiling so the wrapper's own timeout reply arrives first. */
const SCRIPT_TIMEOUT_MARGIN_MS = 15_000;

/** Resolve once the response headers arrive; the body is left unbounded. */
async function fetchUntilHeaders(
  url: string,
  init: RequestInit,
  headersTimeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("The operation timed out.", "TimeoutError")),
    headersTimeoutMs,
  );
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Open a backup download and hand back the live response.
 *
 * Deliberately NOT `apiGet`: that decodes JSON into memory, and these
 * archives are measured in gigabytes. The caller gets the Response with its
 * body still unread so it can pipe it straight through; buffering here would
 * take the dashboard process down on the first big world.
 *
 * `range` is forwarded verbatim so a browser's resume request reaches the
 * wrapper intact, and the body has no timeout: a multi-gigabyte transfer is
 * legitimately slower than any figure that would make sense as a ceiling.
 * Only the wait for the response headers is bounded; once they arrive the
 * body streams for as long as it needs.
 */
export async function openBackupDownload(
  cfg: ServerConfig,
  fileId: string,
  range?: string,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
  if (range) headers["range"] = range;
  return fetchUntilHeaders(
    instanceUrl(cfg, `/backups/files/${encodeURIComponent(fileId)}/download`),
    { headers },
    BACKUP_DOWNLOAD_HEADERS_TIMEOUT_MS,
  );
}

/**
 * Restore the world from one archive.
 *
 * Its own wrapper route rather than a script action, because the path it
 * needs cannot be a script argument (the wrapper's arg validator forbids "/"
 * so a client can never hand a path to a spawned shell). The wrapper resolves
 * the id to a path itself.
 *
 * The ceiling is the wrapper's restore timeout plus a margin: a restore
 * unpacks a whole world, and giving up on this side while the script keeps
 * running would report a failure that is actually still in progress.
 */
export async function restoreBackupFile(
  cfg: ServerConfig,
  fileId: string,
): Promise<ScriptResult> {
  const url = instanceUrl(
    cfg,
    `/backups/files/${encodeURIComponent(fileId)}/restore`,
  );
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
  const res = await fetch(url, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(RESTORE_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API POST /backups/restore → ${res.status}: ${text}`);
  }
  return res.json() as Promise<ScriptResult>;
}

/**
 * Permanently delete one archive (wrapper's backup-files feature v2).
 *
 * Same reasoning as restore: its own route, not a script action, because
 * the wrapper resolves the id to a path itself — no caller here or in the
 * browser is ever in a position to name one.
 */
export async function deleteBackupFile(
  cfg: ServerConfig,
  fileId: string,
): Promise<BackupDeleteResult> {
  const url = instanceUrl(cfg, `/backups/files/${encodeURIComponent(fileId)}`);
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;
  const res = await fetch(url, {
    method: "DELETE",
    headers,
    signal: AbortSignal.timeout(BACKUP_DELETE_TIMEOUT_MS),
  });
  if (res.status === 404) return { ok: false };
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API DELETE /backups/files → ${res.status}: ${text}`);
  }
  return res.json() as Promise<BackupDeleteResult>;
}

// ── Mod config files ───────────────────────────────────────────────

export type { ConfigFileInfo };

export type ConfigFileContents = WireSchemas["ConfigFileRead"];

export interface ConfigIndexResult {
  files: ConfigFileInfo[];
  /** The wrapper stopped listing at its file limit. */
  truncated: boolean;
}

async function wrapperErrorText(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string") return parsed.error;
  } catch {
    /* not JSON */
  }
  return text.slice(0, 200);
}

/** Throw a typed error for statuses the editor can explain; otherwise a plain one. */
async function throwConfigFailure(
  res: Response,
  route: string,
  action: "read" | "write",
): Promise<never> {
  const message = await wrapperErrorText(res);
  throw (
    configAccessErrorFor(res.status, action, message) ??
    new Error(`API ${route} → ${res.status}: ${message}`)
  );
}

export async function indexConfigFiles(
  cfg: ServerConfig,
): Promise<ConfigIndexResult> {
  const body = await apiGet<{ files: ConfigFileInfo[]; truncated?: boolean }>(
    cfg,
    "/configs",
  );
  // Wrappers older than the nested-config index omit these fields.
  return {
    files: body.files.map((f) => ({
      ...f,
      editable: f.editable ?? true,
      tooLarge: f.tooLarge ?? false,
    })),
    truncated: body.truncated ?? false,
  };
}

export async function readConfigFile(
  cfg: ServerConfig,
  fileId: string,
): Promise<ConfigFileContents> {
  const route = `/configs/${encodeURIComponent(fileId)}`;
  const res = await apiGetRaw(cfg, route);
  if (!res.ok) await throwConfigFailure(res, route, "read");
  const body = (await res.json()) as ConfigFileContents;
  return {
    ...body,
    file: {
      ...body.file,
      editable: body.file.editable ?? true,
      tooLarge: body.file.tooLarge ?? false,
    },
  };
}

/**
 * Write a config file back.
 *
 * `etag` is required all the way down, so a stale editor cannot overwrite a
 * file the game rewrote at shutdown. A mismatch comes back as a typed
 * conflict rather than an exception, because it is an expected outcome the UI
 * has to explain, not a failure. Size, missing-file and precondition failures
 * throw a {@link ConfigAccessError} carrying a message safe to show.
 */
export async function writeConfigFile(
  cfg: ServerConfig,
  fileId: string,
  text: string,
  etag: string,
): Promise<
  { ok: true; etag: string; snapshot: string } | { ok: false; conflict: true }
> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "if-match": etag,
  };
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;

  const res = await fetch(
    instanceUrl(cfg, `/configs/${encodeURIComponent(fileId)}`),
    {
      method: "PUT",
      headers,
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(CONFIG_WRITE_TIMEOUT_MS),
    },
  );
  if (res.status === 412) return { ok: false, conflict: true };
  if (res.status === 429) {
    throw new ConfigAccessError(
      "rate-limited",
      "The server's API is rate limiting requests. Wait a moment and save again.",
      429,
    );
  }
  if (!res.ok) await throwConfigFailure(res, "PUT /configs", "write");
  const body = (await res.json()) as { etag: string; snapshot: string };
  return { ok: true, ...body };
}

const CONFIG_WRITE_TIMEOUT_MS = 30_000;

export async function revertConfigFile(
  cfg: ServerConfig,
  fileId: string,
  snapshot: string,
): Promise<{ etag: string }> {
  return apiPost<{ etag: string }>(
    cfg,
    `/configs/${encodeURIComponent(fileId)}/revert`,
    { snapshot },
  );
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
  const waitMs =
    scriptTimeoutMs(action, advertisedScriptTimeouts.get(wrapperKey(cfg))) +
    SCRIPT_TIMEOUT_MARGIN_MS;
  try {
    return await apiPost<ScriptResult>(
      cfg,
      "/scripts/run",
      { action, args },
      waitMs,
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ScriptStillRunningError(action, waitMs);
    }
    throw err;
  }
}

/**
 * The bot stopped waiting for a script that the wrapper may still be running.
 * The outcome is unknown, so callers report "still running", not "failed".
 */
export class ScriptStillRunningError extends Error {
  constructor(
    readonly action: string,
    readonly waitedMs: number,
  ) {
    super(
      `Script '${action}' did not finish within ${Math.round(waitedMs / 1000)}s; it may still be running`,
    );
    this.name = "ScriptStillRunningError";
  }
}

// ── Log streaming (SSE, used by the bot's watcher and the dashboard) ──────

/** Returns the SSE endpoint URL for a remote instance's log stream. */
export function logStreamUrl(cfg: ServerConfig): string {
  if (!cfg.apiUrl)
    throw new Error(`logStreamUrl called on local instance '${cfg.id}'`);
  return `${cfg.apiUrl.replace(/\/$/, "")}/instances/${cfg.id}/logs/stream`;
}

/** What a caller of openLogStream cares about. */
export interface LogStreamHandlers {
  /** One log line, already unwrapped from its SSE frame. */
  onLine: (line: string) => void;
  onConnect?: () => void;
  onDisconnect?: (reason: string) => void;
}

/**
 * Open the wrapper's log stream for one instance.
 *
 * This is the only place that knows the wrapper sends `{"line": "..."}` in
 * each `data:` frame, and the only place that attaches the API key to a
 * stream. `SseLineStream` underneath is pure transport and knows neither —
 * the split is what lets the transport be tested without a wrapper and keeps
 * the wrapper's payload contract in the module that owns every other route.
 *
 * The returned stream is NOT started; call `.start()`. Callers own the
 * lifetime and must `.stop()` it.
 */
export function openLogStream(
  cfg: ServerConfig,
  handlers: LogStreamHandlers,
): SseLineStream {
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;

  return new SseLineStream({
    url: logStreamUrl(cfg),
    headers,
    scope: cfg.id,
    onData: (payload) => {
      try {
        const { line } = JSON.parse(payload) as { line?: unknown };
        // A frame without a string line is a wrapper we don't understand, not
        // an empty log line: drop it rather than emitting "undefined".
        if (typeof line === "string") handlers.onLine(line);
      } catch {
        /* malformed frame — skip, the next one is independent */
      }
    },
    ...(handlers.onConnect ? { onConnect: handlers.onConnect } : {}),
    ...(handlers.onDisconnect ? { onDisconnect: handlers.onDisconnect } : {}),
  });
}
