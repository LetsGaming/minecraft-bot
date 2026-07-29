/**
 * Host resources — what the wrapper's `/info` reports about the machine a
 * server runs on.
 *
 * The bot ran `ps` and `df` itself until 5.0.0, which only ever worked when
 * it shared a machine with the server. The wrapper is on that machine; it
 * measures. A wrapper that predates the host block yields null, and the
 * status view / disk monitor skip the instance rather than guess.
 *
 * Two shapes arrive here. host-info v1 sent a Java-process block and flat
 * `df` figures per path; v2 adds whole-machine CPU/RAM and splits each disk
 * into "this directory's size" plus "the filesystem it sits on". Everything
 * downstream reads the v2 shape, so normalising v1 into it happens once,
 * here, rather than in every renderer.
 */
import { getRemoteInfo } from "./serverAccess.js";
import type { ServerInstance } from "./server.js";

export interface FilesystemUsage {
  mountPoint: string;
  usedPercent: number;
  availableBytes: number;
  totalBytes: number;
}

export interface DiskUsage {
  /** The directory that was measured (world dir, backups dir). */
  path: string;
  /**
   * The directory's own size. null from a v1 wrapper, which never measured
   * it, and from a v2 wrapper whose `du` timed out.
   */
  sizeBytes: number | null;
  filesystem: FilesystemUsage;
}

export interface ProcessUsage {
  pid: number;
  /** Sampled, not ps's lifetime average. Can exceed 100 on multiple cores. */
  cpuPercent: number;
  rssBytes: number;
}

/** The whole machine, as an operator means it. v2 wrappers on Linux only. */
export interface MachineUsage {
  cpuPercent: number;
  cpuCount: number;
  memTotalBytes: number;
  memUsedBytes: number;
  uptimeSeconds: number;
}

export interface HostResources {
  process: ProcessUsage | null;
  machine: MachineUsage | null;
  disks: DiskUsage[];
}

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * One disk entry from either wrapper generation, or null if neither shape
 * is complete enough to render honestly.
 */
export function normaliseDisk(raw: unknown): DiskUsage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.path !== "string") return null;

  const fs = d.filesystem;
  if (typeof fs === "object" && fs !== null) {
    const f = fs as Record<string, unknown>;
    if (
      !isFiniteNumber(f.usedPercent) ||
      !isFiniteNumber(f.availableBytes) ||
      !isFiniteNumber(f.totalBytes)
    ) {
      return null;
    }
    return {
      path: d.path,
      sizeBytes: isFiniteNumber(d.sizeBytes) ? d.sizeBytes : null,
      filesystem: {
        mountPoint: typeof f.mountPoint === "string" ? f.mountPoint : "",
        usedPercent: f.usedPercent,
        availableBytes: f.availableBytes,
        totalBytes: f.totalBytes,
      },
    };
  }

  // v1: flat df figures, no directory size and no mount point.
  if (
    !isFiniteNumber(d.usedPercent) ||
    !isFiniteNumber(d.availableBytes) ||
    !isFiniteNumber(d.totalBytes)
  ) {
    return null;
  }
  return {
    path: d.path,
    sizeBytes: null,
    filesystem: {
      mountPoint: "",
      usedPercent: d.usedPercent,
      availableBytes: d.availableBytes,
      totalBytes: d.totalBytes,
    },
  };
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
  if (!host || (!host.process && !host.host && !host.disks)) return null;

  return {
    process: host.process ?? null,
    machine: host.host ?? null,
    disks: (host.disks ?? [])
      .map(normaliseDisk)
      .filter((d): d is DiskUsage => d !== null),
  };
}
