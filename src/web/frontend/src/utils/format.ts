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

/**
 * Players as text, with "we don't know" kept distinct from "nobody".
 *
 * A null roster used to arrive here as 0/0 and render as a confident
 * "0 players online" during exactly the moments the interface had no idea.
 */
export function playersLabel(
  players: { online: number; max: number } | null,
): string {
  return players ? `${players.online}/${players.max}` : "—";
}

/** TPS → a PrimeVue severity for tags/accents. */
export function tpsSeverity(tps: number): "success" | "warn" | "danger" {
  return tps >= 18 ? "success" : tps >= 12 ? "warn" : "danger";
}

/** A disk as the status payload reports it, plus the paths that resolved to it. */
export interface MergedDisk {
  label: string;
  paths: string[];
  usedBytes: number;
  totalBytes: number;
  usedPercent: number;
}

/**
 * Collapse disks that are demonstrably the same volume.
 *
 * The suite's server and backup directories are usually two paths on one
 * filesystem, so the card showed "Server disk 42.6 GB / 119.0 GB · 33% used"
 * and "Backups disk 42.6 GB / 119.0 GB · 33% used" side by side. Identical
 * numbers twice reads as a rendering bug, and it costs the reader a moment
 * every time to work out that it is not one.
 *
 * Identical used *and* total bytes is the signal: two genuinely separate
 * volumes agreeing to the byte on both figures does not happen in practice,
 * and if it ever did, the merged row still states the truth — it just lists
 * both roles against one meter.
 */
export function mergeDisks(
  disks: readonly { path: string; usedBytes: number; totalBytes: number; usedPercent: number }[],
): MergedDisk[] {
  const byVolume = new Map<string, MergedDisk>();
  for (const disk of disks) {
    const key = `${disk.usedBytes}:${disk.totalBytes}`;
    const existing = byVolume.get(key);
    if (existing) {
      existing.paths.push(disk.path);
      const role = diskLabel(disk.path);
      // "Server disk" + "Backups disk" → "Server + backups disk".
      if (!existing.label.toLowerCase().includes(role.split(" ")[0]!.toLowerCase())) {
        existing.label = `${existing.label.replace(/ disk$/i, "")} + ${role.replace(/ disk$/i, "").toLowerCase()} disk`;
      }
      continue;
    }
    byVolume.set(key, {
      label: diskLabel(disk.path),
      paths: [disk.path],
      usedBytes: disk.usedBytes,
      totalBytes: disk.totalBytes,
      usedPercent: disk.usedPercent,
    });
  }
  return [...byVolume.values()];
}

/** Fullness → a severity, so a meter warns at the same point the alert list does. */
export function diskSeverity(usedPercent: number): "good" | "mid" | "bad" {
  if (usedPercent >= 90) return "bad";
  if (usedPercent >= 75) return "mid";
  return "good";
}

/**
 * A backup tier as a person would say it.
 *
 * The wrapper names tiers by where it files them (`hourly`,
 * `archives/daily`, `archives/update`), and the table printed those paths
 * verbatim — so the retention tier, which is the one thing that column
 * exists to communicate, arrived as a storage detail with a slash in it.
 */
export function tierLabel(tier: string): string {
  const leaf = tier.split("/").pop() ?? tier;
  switch (leaf.toLowerCase()) {
    case "hourly":
      return "Hourly";
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "monthly":
      return "Monthly";
    case "update":
      return "Pre-update";
    case "manual":
      return "Manual";
    default:
      return leaf.charAt(0).toUpperCase() + leaf.slice(1);
  }
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
