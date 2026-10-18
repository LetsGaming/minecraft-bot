/** Mod config file index, read, write and revert. */

import type { ServerConfig } from "../../../types/index.js";
import { ConfigAccessError, configAccessErrorFor } from "../configAccessError.js";
import type { ConfigFileInfo, WireSchemas } from "@mcbot/schema/wire/index.js";
import {
  ApiError,
  RateLimitedError,
  apiGet,
  apiGetRaw,
  requestLabel,
  wrapperErrorMessage,
  wrapperFetch,
} from "./apiClient.js";
import { WRAPPER_TIMEOUTS_MS } from "./wrapperTimeouts.js";

export type { ConfigFileInfo };

export type ConfigFileContents = WireSchemas["ConfigFileRead"];

export interface ConfigIndexResult {
  files: ConfigFileInfo[];
  /** The wrapper stopped listing at its file limit. */
  truncated: boolean;
}

/** Throw a typed error for statuses the editor can explain; otherwise a plain one. */
async function throwConfigFailure(
  res: Response,
  route: string,
  action: "read" | "write",
): Promise<never> {
  const message = wrapperErrorMessage(await res.text(), 200);
  throw (
    configAccessErrorFor(res.status, action, message) ??
    new ApiError(route, res.status, message)
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

export interface ConfigWriteOptions {
  /**
   * Let a write change `server.properties` keys the wrapper protects (RCON,
   * online-mode, whitelist, op level, …). Sent for bot sysadmins only.
   */
  allowProtected?: boolean;
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
  options: ConfigWriteOptions = {},
): Promise<
  { ok: true; etag: string; snapshot: string } | { ok: false; conflict: true }
> {
  const route = `/configs/${encodeURIComponent(fileId)}`;
  const res = await sendConfigWrite(cfg, "PUT", route, etag, {
    text,
    ...(options.allowProtected ? { allowProtected: true } : {}),
  });
  if (res.status === 412) return { ok: false, conflict: true };
  if (!res.ok) await throwConfigFailure(res, requestLabel("PUT", route), "write");
  const body = (await res.json()) as { etag: string; snapshot: string };
  return { ok: true, ...body };
}

async function sendConfigWrite(
  cfg: ServerConfig,
  method: "PUT" | "POST",
  route: string,
  etag: string,
  body: Record<string, unknown>,
): Promise<Response> {
  try {
    return await wrapperFetch(cfg, route, {
      method,
      body,
      timeoutMs: WRAPPER_TIMEOUTS_MS.mutate,
      headers: { "if-match": etag },
    });
  } catch (err) {
    if (err instanceof RateLimitedError) {
      throw new ConfigAccessError(
        "rate-limited",
        "The server's API is rate limiting requests. Wait a moment and save again.",
        429,
      );
    }
    throw err;
  }
}

/**
 * Restore a snapshot. Like a write, it names the version it replaces
 * (wrapper mod-configs v2 refuses a revert without one), so reverting a
 * file the game has rewritten since it was opened is a conflict, not a
 * silent overwrite.
 */
export async function revertConfigFile(
  cfg: ServerConfig,
  fileId: string,
  snapshot: string,
  etag: string,
  options: ConfigWriteOptions = {},
): Promise<{ ok: true; etag: string } | { ok: false; conflict: true }> {
  const route = `/configs/${encodeURIComponent(fileId)}/revert`;
  const res = await sendConfigWrite(cfg, "POST", route, etag, {
    snapshot,
    ...(options.allowProtected ? { allowProtected: true } : {}),
  });
  if (res.status === 412) return { ok: false, conflict: true };
  if (!res.ok) await throwConfigFailure(res, requestLabel("POST", route), "write");
  const body = (await res.json()) as { etag: string };
  return { ok: true, etag: body.etag };
}
