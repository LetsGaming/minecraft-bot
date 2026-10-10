/** Console command delivery and its outcome classification. */

import * as breaker from "../circuitBreaker.js";
import { isRecord } from "../../objects.js";
import { UnreachableReason, type CommandOutcome } from "@mcbot/schema/commandOutcome.js";
import type { ServerConfig } from "../../../types/index.js";
import { instanceUrl } from "./apiClient.js";

const COMMAND_TIMEOUT_MS = 20_000;

function unreachable(
  reason: UnreachableReason,
  detail: string,
): CommandOutcome {
  return { kind: "unreachable", reason, detail };
}

/**
 * Read a `POST /command` body. A wrapper with `rcon-command` v2 names the
 * channel (`via`); an older one answers `{ result }` only, where a string
 * is an RCON reply and `null` is a screen send.
 */
function parseCommandReply(body: unknown): CommandOutcome {
  if (!isRecord(body) || !("result" in body)) {
    return unreachable(UnreachableReason.HttpError, "malformed command reply");
  }
  const { result, via, sent, rconError } = body;
  if (result !== null && typeof result !== "string") {
    return unreachable(UnreachableReason.HttpError, "malformed command reply");
  }
  if (sent === false) {
    return unreachable(UnreachableReason.ScreenFailed, "wrapper reported sent=false");
  }
  if (via === "screen" || (via === undefined && result === null)) {
    return {
      kind: "sent",
      via: typeof rconError === "string" ? "rcon-fallback" : "screen",
    };
  }
  return { kind: "delivered", output: result ?? "" };
}

/**
 * Send a console command and say what became of it. Never throws.
 *
 * Goes through the circuit breaker like reads do: a down wrapper otherwise
 * costs every in-game command the full request timeout. A 429 or a 4xx/502
 * answer proves the wrapper is reachable, so only transport failures and
 * other 5xx responses count against the breaker.
 */
export async function sendCommandOutcome(
  cfg: ServerConfig,
  command: string,
): Promise<CommandOutcome> {
  if (!breaker.shouldAttempt(cfg.id)) {
    return unreachable(
      UnreachableReason.BreakerOpen,
      `circuit breaker open for ${cfg.id}`,
    );
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers["x-api-key"] = cfg.apiKey;

  let res: Response;
  try {
    res = await fetch(instanceUrl(cfg, "/command"), {
      method: "POST",
      headers,
      body: JSON.stringify({ command }),
      signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
    });
  } catch (err) {
    breaker.recordFailure(cfg.id);
    const name = err instanceof Error ? err.name : "";
    const timedOut = name === "TimeoutError" || name === "AbortError";
    return unreachable(
      timedOut ? UnreachableReason.Timeout : UnreachableReason.WrapperDown,
      err instanceof Error ? err.message : String(err),
    );
  }

  if (res.status === 429) {
    breaker.recordSuccess(cfg.id);
    return unreachable(UnreachableReason.RateLimited, "wrapper answered 429");
  }
  if (res.status >= 500 && res.status !== 502) {
    breaker.recordFailure(cfg.id);
  } else {
    breaker.recordSuccess(cfg.id);
  }
  if (!res.ok) {
    const detail = `API POST /command → ${res.status}`;
    if (res.status === 502) {
      return unreachable(UnreachableReason.ScreenFailed, detail);
    }
    if (res.status === 400 || res.status === 413) {
      return unreachable(UnreachableReason.Rejected, detail);
    }
    return unreachable(UnreachableReason.HttpError, detail);
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return unreachable(UnreachableReason.HttpError, "command reply was not JSON");
  }
  return parseCommandReply(body);
}
