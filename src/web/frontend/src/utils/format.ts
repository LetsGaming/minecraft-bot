import { ServerState, WrapperState } from "../api";
import type { ServerStatus } from "../api";
// Small presentation helpers shared across views, so formatting logic
// lives in one place rather than being copy-pasted per component.

// Byte formatting is shared with the bot's embeds, so it lives in the
// isomorphic package; re-exported here so components keep one import.
export { formatBytes } from "@mcbot/schema";

/**
 * A raw disk path with a bare "4%" means nothing in a UI. Derive a role
 * label from the path so a metric reads "Backups disk 4% used"; callers
 * keep the full path available on hover.
 */
export function diskLabel(path: string): string {
  const p = path.toLowerCase();
  if (p.includes("backup")) return "Backups disk";
  if (p.includes("instance") || p.includes("server")) return "Server disk";
  return "Disk";
}

/** TPS → a PrimeVue severity for tags/accents. */
export function tpsSeverity(tps: number): "success" | "warn" | "danger" {
  return tps >= 18 ? "success" : tps >= 12 ? "warn" : "danger";
}

// ── Server state presentation ───────────────────────────────────────────────
// One mapping for the dot, the tag and the copy, because three components
// render this and they used to each translate a boolean into their own words.
// That is how a healthy server behind an unreachable API wrapper came to be
// labelled "Offline" in three different places at once.

/** The StatusDot variant for a server state. */
export function stateDot(state: ServerState): "up" | "down" | "stale" {
  if (state === ServerState.Online) return "up";
  // Amber for both "up but not answering" and "we could not tell" — neither is
  // a confirmed outage, and rendering them red is the original bug in CSS.
  if (state === ServerState.Offline) return "down";
  return "stale";
}

/**
 * The dot for a whole status row.
 *
 * A server that is online with its wrapper down is not green: players are
 * fine, but every control the dashboard offers is gone, and a green dot next
 * to buttons that will all fail is its own kind of wrong answer.
 */
export function statusDot(s: ServerStatus): "up" | "down" | "stale" {
  if (s.wrapper === WrapperState.Unreachable && s.state !== ServerState.Offline) {
    return "stale";
  }
  return stateDot(s.state);
}

/** PrimeVue tag severity for a server state. */
export function stateSeverity(
  state: ServerState,
): "success" | "warn" | "danger" | "secondary" {
  switch (state) {
    case ServerState.Online:
      return "success";
    case ServerState.Unresponsive:
      return "warn";
    case ServerState.Offline:
      return "danger";
    default:
      return "secondary";
  }
}

/** Short label for a server state. */
export function stateLabel(state: ServerState): string {
  switch (state) {
    case ServerState.Online:
      return "Online";
    case ServerState.Unresponsive:
      return "Not responding";
    case ServerState.Offline:
      return "Offline";
    default:
      return "State unknown";
  }
}

/**
 * The note that has to appear whenever the wrapper is down, whatever the
 * server is doing. This is the message the old UI could not express: it had
 * one line for two independent facts and picked the wrong one.
 */
export function wrapperNote(s: ServerStatus): string {
  if (s.wrapper !== WrapperState.Unreachable) return "";
  if (s.state === ServerState.Unknown) {
    return "Neither the API wrapper nor the server answered — state unknown.";
  }
  return "API wrapper unreachable — server controls, logs and stats are unavailable. The server itself answered a direct ping.";
}

/**
 * The sentence shown in place of a player count. Each non-online state needs
 * its own, because "this server is not responding right now" was previously
 * shown for all of them — including when the server was fine and the dashboard
 * simply could not reach its API wrapper.
 */
export function stateExplanation(state: ServerState): string {
  switch (state) {
    case ServerState.Unresponsive:
      return "The server process is running but is not answering commands — it may be starting up or under heavy load.";
    case ServerState.Offline:
      return "The server process is not running.";
    case ServerState.Unknown:
      return "Neither the API wrapper nor the server itself answered, so its state could not be determined.";
    default:
      return "";
  }
}
