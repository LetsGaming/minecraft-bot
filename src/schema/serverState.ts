// ── Server state ────────────────────────────────────────────────────────────
// What a server is doing, and — separately — whether we were able to find out.
//
// These were one boolean. `isRunning()` asked the API wrapper, and anything
// that was not a clean `true` became "offline": a wrapper that was down, a
// wrapper that timed out, and a Minecraft server that had genuinely stopped
// all produced the same red dot and the same "Server Down" alert.
//
// Two of those three are wrong, and the wrong ones are the common ones. The
// wrapper is a separate process on the server host — it gets restarted,
// updated, rate-limited, or briefly wedged while the Minecraft server carries
// on with players on it. And a server pinned by chunk generation or a busy
// evening stops answering RCON long before it stops running.
//
// Modelling the states separately is not cosmetic. The old collapse meant a
// lag spike raised a downtime alert, wrote a zero into the uptime history, and
// closed every open play session as a crash.

/** What the Minecraft server itself is doing. */
export const ServerState = {
  /** Process up and answering commands. */
  Online: "online",
  /**
   * Process up, but not answering RCON — still starting, or too loaded to
   * reply inside the probe budget. The server is *not* down.
   */
  Unresponsive: "unresponsive",
  /** Process is not running. Every liveness probe came back negative. */
  Offline: "offline",
  /**
   * Nothing could establish what this server is doing — neither the API
   * wrapper nor a direct ping answered.
   *
   * This is not "offline". It is the bot declining to guess, and it should be
   * rare: it takes the wrapper being down *and* the game port being
   * unreachable at the same time.
   */
  Unknown: "unknown",
} as const;

export type ServerState = (typeof ServerState)[keyof typeof ServerState];

/**
 * Whether the API wrapper answered. Orthogonal to the server's own state, and
 * that orthogonality is the point: the wrapper being down says nothing about
 * whether players are on the server, and folding the two into one value is
 * what produced "server offline" for a server with four people on it.
 *
 * It is still worth reporting on its own, because an unreachable wrapper does
 * cost something real — every control command, the log stream, stats, and the
 * chat bridge run through it.
 */
export const WrapperState = {
  Up: "up",
  Unreachable: "unreachable",
} as const;

export type WrapperState = (typeof WrapperState)[keyof typeof WrapperState];

/** Which channel established `state`. */
export const HealthSource = {
  /** The API wrapper's own probes — the richest answer. */
  Wrapper: "wrapper",
  /** A direct Minecraft server-list ping, with no wrapper involved. */
  Ping: "ping",
  /** Nothing answered. */
  None: "none",
} as const;

export type HealthSource = (typeof HealthSource)[keyof typeof HealthSource];

/** Whether RCON is answering, reported alongside — not instead of — liveness. */
export const RconState = {
  Responsive: "responsive",
  Unresponsive: "unresponsive",
  /** The instance has no RCON configured; liveness came from a process probe. */
  Unconfigured: "unconfigured",
  /** Wrapper too old to say (pre `server-health`), or unreachable. */
  Unknown: "unknown",
} as const;

export type RconState = (typeof RconState)[keyof typeof RconState];

export interface ServerHealth {
  /** What the Minecraft server is doing, from whichever channel could tell. */
  state: ServerState;
  /** Which channel that was. */
  source: HealthSource;
  /** Whether the API wrapper answered — a separate fact from `state`. */
  wrapper: WrapperState;
  /**
   * A probe actually confirmed the process. Never inferred from `state` —
   * `unknown` means we confirmed nothing, and it must not read as `false`
   * anywhere that would treat that as "stopped".
   */
  processUp: boolean;
  rcon: RconState;
  /** Which wrapper-side probe answered (`socket`, `process`, …), when known. */
  probe: string | null;
  /**
   * Players, when the answering channel could supply them.
   *
   * `names` is exact from the wrapper and a capped, best-effort *sample* from
   * a ping — servers publish at most a dozen and plugins can suppress it
   * entirely. `sampled` says which, so nothing renders a partial list as if
   * it were the roster. The counts are exact either way.
   */
  players: { online: number; max: number; names: string[]; sampled: boolean } | null;
  /**
   * Why a channel failed, when one did. Diagnostic, for logs — not
   * user-facing copy.
   */
  reason: string | null;
  /** When the probe ran, or when we gave up. */
  checkedAt: number;
}

/**
 * "Is the server up at all?" — the question nearly every old `isRunning()`
 * caller was really asking. `unknown` is deliberately not up: we established
 * nothing, and claiming otherwise is the same class of lie as the original bug.
 */
export function serverIsUp(health: ServerHealth): boolean {
  return (
    health.state === ServerState.Online ||
    health.state === ServerState.Unresponsive
  );
}

/** Did anything manage to tell us? False only when every channel failed. */
export function stateIsKnown(health: ServerHealth): boolean {
  return health.state !== ServerState.Unknown;
}

/**
 * The wrapper is down, whatever the server itself is doing.
 *
 * Worth surfacing separately even when the server is fine: without the
 * wrapper there are no control commands, no log stream, no chat bridge, no
 * stats. The server being up is the reassuring half; this is the half that
 * still needs someone to do something.
 */
export function wrapperIsDown(health: ServerHealth): boolean {
  return health.wrapper === WrapperState.Unreachable;
}

/**
 * The server itself is answering commands.
 *
 * A statement about the *server*, not about our ability to reach it — a
 * server pinged as online is responsive even with the wrapper down. Use
 * `canQueryServer` before actually issuing a query.
 */
export function serverIsResponsive(health: ServerHealth): boolean {
  return health.state === ServerState.Online;
}

/**
 * We can actually run a query against this server right now.
 *
 * Two conditions, and both are needed: the server has to be answering, *and*
 * the API wrapper has to be reachable, because every query goes through it.
 * Splitting this from `serverIsResponsive` matters because they came apart
 * the moment the bot learned to ping servers directly — a server can be
 * demonstrably online while every query against it fails, and a caller that
 * checks the wrong one asks the wrapper for a player list it cannot deliver
 * and renders the zeros it gets back.
 */
export function canQueryServer(health: ServerHealth): boolean {
  return (
    health.state === ServerState.Online && health.wrapper === WrapperState.Up
  );
}

/**
 * The health value for "no channel could tell us anything".
 *
 * Reaching this takes the wrapper being unreachable *and* the game port not
 * answering. It is the honest floor of what the bot can say, and callers must
 * treat it as ignorance rather than as an outage.
 */
export function unknownHealth(
  reason: string,
  checkedAt: number = Date.now(),
): ServerHealth {
  return {
    state: ServerState.Unknown,
    source: HealthSource.None,
    wrapper: WrapperState.Unreachable,
    processUp: false,
    rcon: RconState.Unknown,
    probe: null,
    players: null,
    reason,
    checkedAt,
  };
}
