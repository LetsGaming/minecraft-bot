/**
 * Host resources — RAM/CPU of the Minecraft process and disk usage of the
 * world and backup paths, as reported by the wrapper's `/info`.
 *
 * The bot ran `ps` and `df` itself until 5.0.0, which only ever worked when
 * it shared a machine with the server. The wrapper is on that machine; it
 * measures. A wrapper that predates the host block yields null, and the
 * status view / disk monitor skip the instance rather than guess.
 *
 * This complements the backup-age alert, which covers backup age and size
 * but not host disk — the recurring failure mode is backups silently
 * filling the disk until the server crashes mid-save.
 */
import { getRemoteInfo } from "./serverAccess.js";
import type { ServerInstance } from "./server.js";

export interface DiskUsage {
  /** The path that was queried (world dir, backups dir). */
  path: string;
  usedPercent: number;
  availableBytes: number;
  totalBytes: number;
}

export interface ProcessUsage {
  pid: number;
  cpuPercent: number;
  rssBytes: number;
}

export interface HostResources {
  process: ProcessUsage | null;
  disks: DiskUsage[];
}

/**
 * Host snapshot for an instance, from the wrapper's `/info`.
 *
 * null means the wrapper is unreachable or predates the host block — the
 * status view and the disk monitor skip the instance rather than guess.
 */
export async function getHostResources(
  server: ServerInstance,
): Promise<HostResources | null> {
  const info = await getRemoteInfo(server.config);
  const host = info?.host;
  if (!host || (!host.process && !host.disks)) return null;
  return {
    process: host.process ?? null,
    disks: (host.disks ?? []).filter(
      (d): d is DiskUsage =>
        !!d &&
        typeof d.path === "string" &&
        Number.isFinite(d.usedPercent) &&
        Number.isFinite(d.availableBytes) &&
        Number.isFinite(d.totalBytes),
    ),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
