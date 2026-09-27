/**
 * A small per-server circuit breaker in front of wrapper calls.
 *
 * Without this, a sustained wrapper outage means every caller — the status
 * poll, the downtime monitor, a Discord command, a dashboard tab — pays its
 * own full connect-and-timeout on every single attempt for as long as the
 * outage lasts. That is wasted latency for the caller and wasted load on a
 * wrapper that may be trying to recover. After enough consecutive failures
 * this opens and fails fast for a cooldown, then lets one probe through
 * (half-open) to test recovery before fully closing again.
 *
 * Deliberately not applied to write operations (scripts, mod mutations,
 * restore, console commands) — those are rare, operator-initiated, and an
 * admin retrying "start the server" during a flaky window should reach the
 * wrapper, not be told no by a breaker tuned for read traffic.
 */

const FAILURE_THRESHOLD = 5;
const OPEN_COOLDOWN_MS = 15_000;

type State = "closed" | "open" | "half-open";

interface BreakerState {
  state: State;
  consecutiveFailures: number;
  openedAt: number;
}

const breakers = new Map<string, BreakerState>();

function getOrCreate(serverId: string): BreakerState {
  let b = breakers.get(serverId);
  if (!b) {
    b = { state: "closed", consecutiveFailures: 0, openedAt: 0 };
    breakers.set(serverId, b);
  }
  return b;
}

/**
 * True when a call should be attempted. False means "fail fast" — the
 * caller should treat this exactly like a wrapper-unreachable error without
 * making a request. Transitions open -> half-open once the cooldown elapses.
 */
export function shouldAttempt(serverId: string, now: number = Date.now()): boolean {
  const b = getOrCreate(serverId);
  if (b.state === "closed") return true;
  if (b.state === "open") {
    if (now - b.openedAt >= OPEN_COOLDOWN_MS) {
      b.state = "half-open";
      return true;
    }
    return false;
  }
  // half-open: only one probe is meant to be in flight at a time, but a
  // second concurrent caller arriving before that probe resolves gets
  // the same "try it" answer rather than being blocked — the probe's own
  // result decides the next state either way, and refusing that second
  // caller would just add another kind of failed request to explain.
  return true;
}

/** Record a successful call — closes the breaker if it was open/half-open. */
export function recordSuccess(serverId: string): void {
  const b = getOrCreate(serverId);
  b.consecutiveFailures = 0;
  b.state = "closed";
}

/** Record a failed call — opens the breaker once past the threshold. */
export function recordFailure(serverId: string, now: number = Date.now()): void {
  const b = getOrCreate(serverId);
  b.consecutiveFailures++;
  if (b.state === "half-open" || b.consecutiveFailures >= FAILURE_THRESHOLD) {
    b.state = "open";
    b.openedAt = now;
  }
}

export function getBreakerState(serverId: string): State {
  return getOrCreate(serverId).state;
}

/** Test seam: drop every breaker. */
export function resetBreakersForTesting(): void {
  breakers.clear();
}
