// ── Console command outcome ─────────────────────────────────────────────────
// What happened to a command the bot sent to a server's console. The old
// `string | null` collapsed four different situations into `null`: delivered
// over a channel with no reply, RCON failed and the screen fallback was tried,
// the screen send failed outright, and the wrapper was never reached. Callers
// that record state ("banned", "tip sent", "cooldown stamped") need to tell
// those apart.

/** Why a command may not have reached the server. */
export const UnreachableReason = {
  /** The wrapper could not be contacted at all. */
  WrapperDown: "wrapper-down",
  /** The wrapper did not answer inside the request budget. */
  Timeout: "timeout",
  /** The circuit breaker is open; no request was made. */
  BreakerOpen: "breaker-open",
  /** The wrapper answered 429. It is healthy, just declining. */
  RateLimited: "rate-limited",
  /** The wrapper answered with an unexpected status or body. */
  HttpError: "http-error",
  /** The wrapper answered but neither RCON nor the screen fallback delivered. */
  ScreenFailed: "screen-failed",
  /** The wrapper refused the command as invalid. */
  Rejected: "rejected",
} as const;
export type UnreachableReason =
  (typeof UnreachableReason)[keyof typeof UnreachableReason];

export type CommandOutcome =
  /** RCON answered. `output` may be the empty string. */
  | { kind: "delivered"; output: string }
  /**
   * Written to the server's console with no reply channel, so success is
   * unverifiable. `rcon-fallback` means RCON was configured but failed.
   * `rcon-no-reply` means RCON took the command but its reply went missing;
   * the wrapper does not re-send it through screen, since it has most likely
   * run already.
   */
  | { kind: "sent"; via: "screen" | "rcon-fallback" | "rcon-no-reply" }
  | { kind: "unreachable"; reason: UnreachableReason; detail: string };

/** The command is believed to have reached the server. */
export function wasAccepted(
  outcome: CommandOutcome,
): outcome is Exclude<CommandOutcome, { kind: "unreachable" }> {
  return outcome.kind !== "unreachable";
}
