/** Console command delivery and its outcome classification. */

import { isRecord } from "../../objects.js";
import { UnreachableReason, type CommandOutcome } from "@mcbot/schema/commandOutcome.js";
import type { ServerConfig } from "../../../types/index.js";
import { BreakerOpenError, RateLimitedError, wrapperFetch } from "./apiClient.js";
import { isTimeoutError } from "../transportError.js";
import { WRAPPER_TIMEOUTS_MS } from "./wrapperTimeouts.js";

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
  // RCON took it but the reply never came back (wrapper W-005): sent, not
  // delivered; an empty output here would read as a real, empty answer.
  if (via === "rcon" && result === null) {
    return { kind: "sent", via: "rcon-no-reply" };
  }
  return { kind: "delivered", output: result ?? "" };
}

/**
 * Send a console command and say what became of it. Never throws.
 *
 * Goes through the circuit breaker like every wrapper request: a down wrapper
 * otherwise costs every in-game command the full request timeout.
 */
export async function sendCommandOutcome(
  cfg: ServerConfig,
  command: string,
): Promise<CommandOutcome> {
  let res: Response;
  try {
    res = await wrapperFetch(cfg, "/command", {
      method: "POST",
      body: { command },
      timeoutMs: WRAPPER_TIMEOUTS_MS.command,
    });
  } catch (err) {
    if (err instanceof BreakerOpenError) {
      return unreachable(UnreachableReason.BreakerOpen, `circuit breaker open for ${cfg.id}`);
    }
    if (err instanceof RateLimitedError) {
      return unreachable(UnreachableReason.RateLimited, "wrapper answered 429");
    }
    return unreachable(
      isTimeoutError(err) ? UnreachableReason.Timeout : UnreachableReason.WrapperDown,
      err instanceof Error ? err.message : String(err),
    );
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
