/**
 * The open console streams, so a config reload can end the ones it
 * invalidates. A stream is authorized once, on connect; without this a grant
 * revoked or a server removed afterwards would keep delivering until the
 * browser closed the tab.
 */
import { currentSessionEpoch, type Session } from "../auth/auth.js";
import { sessionHolds } from "../auth/capabilities.js";
import type { ConsoleEvent } from "./consoleHub.js";

export interface OpenStream {
  serverId: string;
  session: Session;
  /** Write a final frame, end the response and release the hub subscription. */
  close(event: Extract<ConsoleEvent, { type: "closed" }>): void;
}

const open = new Set<OpenStream>();

/** How often each open stream re-checks its viewer, reload event or not. */
export const REVALIDATE_INTERVAL_MS = 30_000;

/**
 * Does this viewer still pass the checks the route made on connect, against
 * the current config? Identity goes stale in two ways: the cookie expires, and
 * the grants/adminUsers that admitted it change.
 */
export function streamStillAllowed(
  session: Session,
  serverId: string,
  now: number = Date.now(),
): boolean {
  return (
    session.exp > now &&
    // Bumping webui.sessionEpoch signs everyone out; an open stream is a
    // session in use, so it ends too.
    (session.ep ?? 0) === currentSessionEpoch() &&
    sessionHolds(session, "server:read", serverId)
  );
}

const REVOKED = {
  type: "closed",
  reason: "revoked",
  detail: "Your access to this console was revoked.",
} as const;

/**
 * Track an open stream and re-check its viewer on a bounded interval, so a
 * revoked user cannot keep reading for the rest of the session even when no
 * config reload event fires. The returned function stops the timer.
 */
export function registerStream(stream: OpenStream): () => void {
  open.add(stream);
  const timer = setInterval(() => {
    if (!streamStillAllowed(stream.session, stream.serverId)) stream.close(REVOKED);
  }, REVALIDATE_INTERVAL_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
    open.delete(stream);
  };
}

/**
 * Streams one person may hold open at once. Each costs a wrapper upstream
 * subscription and a socket; a few tabs are normal, a loop opening hundreds
 * is not.
 */
export const MAX_STREAMS_PER_USER = 8;

/** Open streams held by one user, across servers. */
export function openStreamsForUser(uid: string): number {
  let n = 0;
  for (const stream of open) if (stream.session.uid === uid) n += 1;
  return n;
}

export function openStreamCount(serverId?: string): number {
  if (serverId === undefined) return open.size;
  return [...open].filter((s) => s.serverId === serverId).length;
}

export function closeStreamsForServer(
  serverId: string,
  reason: "removed" | "reconfigured",
): void {
  const detail =
    reason === "removed"
      ? "This server was removed from the configuration."
      : "This server's connection settings changed. Reconnecting.";
  for (const stream of [...open]) {
    if (stream.serverId === serverId) stream.close({ type: "closed", reason, detail });
  }
}

/** Close every stream whose session no longer passes `stillAllowed`. */
export function closeRevokedStreams(
  stillAllowed: (session: Session, serverId: string) => boolean,
): number {
  let closed = 0;
  for (const stream of [...open]) {
    if (stillAllowed(stream.session, stream.serverId)) continue;
    closed += 1;
    stream.close(REVOKED);
  }
  return closed;
}
