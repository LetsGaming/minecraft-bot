/**
 * Host resources: what the wrapper's `/info` reports about the machine a
 * server runs on.
 *
 * The wrapper runs on the Minecraft host, so it does the measuring. A wrapper that predates the host block yields null, and the
 * status view / disk monitor skip the instance rather than guess.
 *
 * Two shapes arrive here. host-info v1 sent a Java-process block and flat
 * `df` figures per path; v2 adds whole-machine CPU/RAM and splits each disk
 * into "this directory's size" plus "the filesystem it sits on". Everything
 * downstream reads the v2 shape, so normalising v1 into it happens once,
 * here, rather than in every renderer.
 */
import { getRemoteInfo } from "./serverAccess.js";
import type { ServerConfig } from "../../types/index.js";
import type { WireSchemas } from "@mcbot/schema/wire/index.js";

export type DiskUsage = WireSchemas["DiskUsage"];
export type FilesystemUsage = DiskUsage["filesystem"];
export type ProcessUsage = WireSchemas["ProcessUsage"];
/** The whole machine, as an operator means it. v2 wrappers on Linux only. */
export type MachineUsage = WireSchemas["HostUsage"];

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

/** The Java process block, or null if it is missing or any figure is not a finite number. */
export function normaliseProcess(raw: unknown): ProcessUsage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (!isFiniteNumber(p.pid) || !isFiniteNumber(p.cpuPercent) || !isFiniteNumber(p.rssBytes)) {
    return null;
  }
  return { pid: p.pid, cpuPercent: p.cpuPercent, rssBytes: p.rssBytes };
}

/** The whole-machine block, or null if it is missing or any figure is not a finite number. */
export function normaliseMachine(raw: unknown): MachineUsage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (
    !isFiniteNumber(m.cpuPercent) ||
    !isFiniteNumber(m.cpuCount) ||
    !isFiniteNumber(m.memTotalBytes) ||
    !isFiniteNumber(m.memUsedBytes) ||
    !isFiniteNumber(m.uptimeSeconds)
  ) {
    return null;
  }
  return {
    cpuPercent: m.cpuPercent,
    cpuCount: m.cpuCount,
    memTotalBytes: m.memTotalBytes,
    memUsedBytes: m.memUsedBytes,
    uptimeSeconds: m.uptimeSeconds,
  };
}

/**
 * Host snapshot for an instance, from the wrapper's `/info`.
 *
 * null means the wrapper is unreachable or predates the host block; the
 * status view and the disk monitor skip the instance rather than guess.
 */
export async function getHostResources(cfg: ServerConfig): Promise<HostResources | null> {
  const info = await getRemoteInfo(cfg);
  const host = info?.host;
  if (!host || (!host.process && !host.host && !host.disks)) return null;

  return {
    process: normaliseProcess(host.process),
    machine: normaliseMachine(host.host),
    disks: (host.disks ?? [])
      .map(normaliseDisk)
      .filter((d): d is DiskUsage => d !== null),
  };
}
