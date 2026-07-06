/**
 * Host resources — RAM/CPU of the server process and disk usage of the
 * world and backup paths. Local instances read through the existing
 * execCommand layer (execSafe: no shell interpolation, so paths cannot
 * inject); remote instances (apiUrl set) get the same numbers from the
 * wrapper's `/info` endpoint (wrapper >= 1.2.0, shipped together with the
 * version handshake). An older wrapper without those fields yields null,
 * and the status view / disk monitor skip the instance instead of
 * guessing — exactly the pre-1.2.0 behaviour.
 *
 * This complements the backup-age alert, which covers backup age and size
 * but not host disk — the recurring failure mode is backups silently
 * filling the disk until the server crashes mid-save.
 */
import path from "path";
import { execSafe } from "../shell/execCommand.js";
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

/** `df -Pk <dir>` (POSIX output format) → parsed usage, null on failure. */
export async function getDiskUsage(dir: string): Promise<DiskUsage | null> {
  const out = await execSafe("df", ["-Pk", dir]);
  if (!out) return null;

  const line = out.split("\n")[1];
  if (!line) return null;
  // Filesystem 1024-blocks Used Available Capacity Mounted-on
  const parts = line.trim().split(/\s+/);
  const totalKb = Number(parts[1]);
  const availKb = Number(parts[3]);
  const usedPercent = Number((parts[4] ?? "").replace("%", ""));
  if (
    !Number.isFinite(totalKb) ||
    !Number.isFinite(availKb) ||
    !Number.isFinite(usedPercent)
  ) {
    return null;
  }
  return {
    path: dir,
    usedPercent,
    availableBytes: availKb * 1024,
    totalBytes: totalKb * 1024,
  };
}

/**
 * RAM/CPU of the server's Java process, identified as the biggest java
 * process owned by the instance's linuxUser. `ps` can read other users'
 * processes without sudo, so no extra sudoers entries are needed.
 */
export async function getServerProcessUsage(
  linuxUser: string,
): Promise<ProcessUsage | null> {
  const out = await execSafe("ps", [
    "-u",
    linuxUser,
    "-o",
    "pid=,pcpu=,rss=,comm=",
  ]);
  if (!out) return null;

  let best: ProcessUsage | null = null;
  for (const line of out.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const comm = parts.slice(3).join(" ");
    if (!comm.toLowerCase().includes("java")) continue;
    const candidate: ProcessUsage = {
      pid: Number(parts[0]),
      cpuPercent: Number(parts[1]),
      rssBytes: Number(parts[2]) * 1024,
    };
    if (!Number.isFinite(candidate.pid)) continue;
    if (!best || candidate.rssBytes > best.rssBytes) best = candidate;
  }
  return best;
}

/** The paths worth watching for an instance: world dir + suite backups. */
export function monitoredPaths(server: ServerInstance): string[] {
  const cfg = server.config;
  const paths = [cfg.serverDir];
  // Suite backup layout: <serverDir>/../backups/<screenSession> — same
  // convention serverAccess.detectCapabilities probes. Only include it
  // when the probe found it, so plain servers don't df a missing dir.
  if (server.capabilities?.backups) {
    paths.push(path.resolve(cfg.serverDir, "..", "backups"));
  }
  // Same filesystem → same df result; dedupe by resolved path.
  return [...new Set(paths.map((p) => path.resolve(p)))];
}

/**
 * Full host snapshot for local AND remote instances. Remote numbers come
 * from the wrapper's `/info`; null means the wrapper predates 1.2.0 (see
 * module docs).
 */
export async function getHostResources(
  server: ServerInstance,
): Promise<HostResources | null> {
  if (server.config.apiUrl) {
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

  const [process, ...disks] = await Promise.all([
    getServerProcessUsage(server.config.linuxUser),
    ...monitoredPaths(server).map((p) => getDiskUsage(p)),
  ]);

  return {
    process,
    disks: disks.filter((d): d is DiskUsage => d !== null),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
