import { StatusRole, classifyDiskUsage, classifyTps } from "@mcbot/schema";
import { ServerState, WrapperState } from "../api";
import type { ServerStatus } from "../api";
import { t, type MessageKey } from "../i18n";
// Small presentation helpers shared across views, so formatting logic
// lives in one place rather than being copy-pasted per component.

// Byte formatting is shared with the bot's embeds, so it lives in the
// isomorphic package; re-exported here so components keep one import.
export { formatBytes } from "@mcbot/schema";

type DiskRole = "server" | "backups" | "other";

function diskRole(path: string): DiskRole {
  const p = path.toLowerCase();
  if (p.includes("backup")) return "backups";
  if (p.includes("instance") || p.includes("server")) return "server";
  return "other";
}

const DISK_LABEL: Record<DiskRole, MessageKey> = {
  server: "servers.disk.server",
  backups: "servers.disk.backups",
  other: "servers.disk.other",
};

/** TPS as a status role, so the chip reads like every other health signal. */
export function tpsRole(tps: number): StatusRole {
  switch (classifyTps(tps)) {
    case "ok":
      return StatusRole.Online;
    case "warn":
      return StatusRole.Degraded;
    default:
      return StatusRole.Offline;
  }
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
 * numbers twice reads as a rendering bug.
 *
 * Identical used *and* total bytes is the signal: two genuinely separate
 * volumes agreeing to the byte on both figures does not happen in practice,
 * and if it ever did, the merged row still states the truth, it just lists
 * both roles against one meter.
 */
export function mergeDisks(
  disks: readonly { path: string; usedBytes: number; totalBytes: number; usedPercent: number }[],
): MergedDisk[] {
  const byVolume = new Map<string, MergedDisk & { roles: Set<DiskRole> }>();
  for (const disk of disks) {
    const key = `${disk.usedBytes}:${disk.totalBytes}`;
    const role = diskRole(disk.path);
    const existing = byVolume.get(key);
    if (existing) {
      existing.paths.push(disk.path);
      existing.roles.add(role);
      if (existing.roles.has("server") && existing.roles.has("backups")) {
        existing.label = t("servers.disk.serverAndBackups");
      }
      continue;
    }
    byVolume.set(key, {
      label: t(DISK_LABEL[role]),
      roles: new Set([role]),
      paths: [disk.path],
      usedBytes: disk.usedBytes,
      totalBytes: disk.totalBytes,
      usedPercent: disk.usedPercent,
    });
  }
  return [...byVolume.values()].map(({ roles: _roles, ...disk }) => disk);
}

/** Fullness → a severity, so a meter warns at the same point the alert list does. */
export function diskSeverity(usedPercent: number): "good" | "mid" | "bad" {
  switch (classifyDiskUsage(usedPercent)) {
    case "critical":
      return "bad";
    case "warn":
      return "mid";
    default:
      return "good";
  }
}

// ── Server state presentation ───────────────────────────────────────────────
// One mapping for the chip and the copy, because several components render
// this. A healthy server behind an unreachable API wrapper was once labelled
// "Offline" in three places at once because each translated a boolean itself.

/** The StatusDot variant for a server state. */
export function stateDot(state: ServerState): "up" | "down" | "stale" {
  if (state === ServerState.Online) return "up";
  // Amber for both "up but not answering" and "we could not tell": neither is
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

/** The status role of a whole server row, wrapper included (see statusDot). */
export function serverRole(s: ServerStatus): StatusRole {
  if (s.wrapper === WrapperState.Unreachable && s.state === ServerState.Online) {
    return StatusRole.Degraded;
  }
  switch (s.state) {
    case ServerState.Online:
      return StatusRole.Online;
    case ServerState.Offline:
      return StatusRole.Offline;
    case ServerState.Unresponsive:
      return StatusRole.Degraded;
    default:
      return StatusRole.Unknown;
  }
}

/** Short label for a server state. */
export function stateLabel(state: ServerState): string {
  switch (state) {
    case ServerState.Online:
      return t("status.online");
    case ServerState.Unresponsive:
      return t("status.degraded");
    case ServerState.Offline:
      return t("status.offline");
    default:
      return t("servers.stateUnknown");
  }
}

/** The chip label for a server row: its state, or that only the wrapper is missing. */
export function serverRoleLabel(s: ServerStatus): string {
  if (s.wrapper === WrapperState.Unreachable && s.state === ServerState.Online) {
    return t("servers.wrapperDownChip");
  }
  return stateLabel(s.state);
}

/**
 * The note that has to appear whenever the wrapper is down, whatever the
 * server is doing. The old UI had one line for two independent facts and
 * picked the wrong one.
 */
export function wrapperNote(s: ServerStatus): string {
  if (s.wrapper !== WrapperState.Unreachable) return "";
  if (s.state === ServerState.Unknown) return t("servers.wrapperNoteUnknown");
  return t("servers.wrapperNote");
}

/**
 * The sentence shown in place of a player count. Each non-online state needs
 * its own: one shared "not responding" line used to cover the case where the
 * server was fine and only its API wrapper was unreachable.
 */
export function stateExplanation(state: ServerState): string {
  switch (state) {
    case ServerState.Unresponsive:
      return t("servers.explainUnresponsive");
    case ServerState.Offline:
      return t("servers.explainOffline");
    case ServerState.Unknown:
      return t("servers.explainUnknown");
    default:
      return "";
  }
}
