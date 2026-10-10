/** Backup directory summary, archive index, download, restore and delete. */

import type {
  ServerConfig,
  BackupSummary,
  BackupFileIndex,
  ScriptResult,
} from "../../../types/index.js";
import type { BackupDeleteResult } from "@mcbot/schema/wire/index.js";
import { instanceUrl, apiGet } from "./apiClient.js";

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
 * it builds itself; so no caller, here or in the browser, is ever in a
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
 * the wrapper resolves the id to a path itself; no caller here or in the
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
