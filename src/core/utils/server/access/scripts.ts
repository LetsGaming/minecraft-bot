/** Management script execution. */

import { scriptTimeoutMs } from "../wrapperContract.js";
import type { ServerConfig, ScriptResult } from "../../../types/index.js";
import { apiPost, ApiError, RateLimitedError } from "./apiClient.js";
import { getAdvertisedScriptTimeouts } from "./manifest.js";
import { isTimeoutError } from "../transportError.js";
import { MS } from "@mcbot/schema/time.js";

/** Margin added to a script's ceiling so the wrapper's own timeout reply arrives first. */
const SCRIPT_TIMEOUT_MARGIN_MS = 15 * MS.second;

/**
 * Run a named server management script (start / stop / restart / backup / status)
 * through the API wrapper.
 */
export async function runScript(
  cfg: ServerConfig,
  action: string,
  args: string[] = [],
): Promise<ScriptResult> {
  const waitMs =
    scriptTimeoutMs(action, getAdvertisedScriptTimeouts(cfg)) +
    SCRIPT_TIMEOUT_MARGIN_MS;
  try {
    return await apiPost<ScriptResult>(
      cfg,
      "/scripts/run",
      { action, args },
      waitMs,
    );
  } catch (err) {
    if (isTimeoutError(err)) {
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
      `Script '${action}' did not finish within ${Math.round(waitedMs / MS.second)}s; it may still be running`,
    );
    this.name = "ScriptStillRunningError";
  }
}

/**
 * What a failed script call means for the person who asked.
 *
 * - `still-running`: we stopped waiting, the host may still be doing it.
 *   Offering a retry would start it a second time.
 * - `refused`: the wrapper answered and said no (busy with another
 *   operation, bad request, its own error). It did not run as asked, but the
 *   wrapper is there, so this is not something to offer again later.
 * - `unreachable`: the wrapper did not answer at all, so it did not run.
 */
export type ScriptFailure =
  | { kind: "still-running" }
  | { kind: "refused"; status: number; message: string }
  | { kind: "unreachable" };

export function classifyScriptFailure(err: unknown): ScriptFailure {
  if (err instanceof ScriptStillRunningError) return { kind: "still-running" };
  if (isTimeoutError(err)) return { kind: "still-running" };
  if (err instanceof RateLimitedError) {
    return { kind: "refused", status: 429, message: "rate limited" };
  }
  if (err instanceof ApiError) {
    return { kind: "refused", status: err.status, message: err.wrapperMessage };
  }
  return { kind: "unreachable" };
}
