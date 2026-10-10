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

import { scriptTimeoutMs } from "./wrapperContract.js";
import { SseLineStream } from "../sseLineStream.js";
import type { ServerConfig, ScriptResult, ServerCapabilities } from "../../types/index.js";
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
import { instanceUrl, apiGetRaw, apiGet, apiPost } from "./access/apiClient.js";
import { advertisedScriptTimeouts, wrapperKey } from "./access/manifest.js";

export { RateLimitedError } from "./access/apiClient.js";
export { forgetGamePort, rememberGamePort, pingTarget, pingServer, getHealth, isRunning, getList, getTps } from "./access/health.js";
export { sendCommandOutcome } from "./access/commands.js";
export { getRemoteInfo, versionAtLeast } from "./access/host.js";
export type { RemoteInfo } from "./access/host.js";
export { getRemoteManifest, verifyWrapperContract } from "./access/manifest.js";
export { readWhitelist, readUserCache } from "./access/players.js";
export { readLevelName, readStats, listStatsUuids, readAllStats, deleteStatsFile } from "./access/stats.js";
export { readModSlugs, listInstalledMods, addMod, removeMod, checkModUpdates, applyModUpdates, updateMod, disableMod, enableMod } from "./access/mods.js";
export { supportsModCompat, startModCompat, getModCompat } from "./access/modCompat.js";
export { readBackups, indexBackupFiles, openBackupDownload, restoreBackupFile, deleteBackupFile } from "./access/backups.js";

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

/** Margin added to a script's ceiling so the wrapper's own timeout reply arrives first. */
const SCRIPT_TIMEOUT_MARGIN_MS = 15_000;

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
