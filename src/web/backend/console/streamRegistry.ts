/**
 * The open console streams, so a config reload can end the ones it
 * invalidates. A stream is authorized once, on connect; without this a grant
 * revoked or a server removed afterwards would keep delivering until the
 * browser closed the tab.
 */
import type { Session } from "../auth/auth.js";
import type { ConsoleEvent } from "./consoleHub.js";

export interface OpenStream {
  serverId: string;
  session: Session;
  /** Write a final frame, end the response and release the hub subscription. */
  close(event: Extract<ConsoleEvent, { type: "closed" }>): void;
}

const open = new Set<OpenStream>();

export function registerStream(stream: OpenStream): () => void {
  open.add(stream);
  return () => open.delete(stream);
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
    stream.close({
      type: "closed",
      reason: "revoked",
      detail: "Your access to this console was revoked.",
    });
  }
  return closed;
}
