/**
 * Live per-server status collection (phase 1), shared by the /api/status
 * route and the Prometheus exposition — both must produce the same
 * numbers, so there is exactly one collector.
 *
 * Split out of server.ts in the QUAL-01 refactor (2026-07 audit).
 */
import { getServerInstance } from "@mcbot/core/utils/server.js";
import { getHostResources } from "@mcbot/core/utils/hostResources.js";
import type { ServerStatus } from "@mcbot/schema/contract.js";

export async function collectStatus(serverId: string): Promise<ServerStatus> {
  const server = getServerInstance(serverId);
  if (!server) throw new Error(`unknown server ${serverId}`);

  const base: ServerStatus = {
    id: serverId,
    online: false,
    players: { online: 0, max: 0, names: [] },
    tps: null,
    host: null,
  };

  try {
    if (!(await server.isRunning())) return base;
    base.online = true;
    const list = await server.getList();
    base.players = {
      online: parseInt(String(list.playerCount), 10) || 0,
      max: parseInt(String(list.maxPlayers), 10) || 0,
      names: list.players ?? [],
    };
  } catch {
    return base;
  }

  try {
    const tps = await server.getTps();
    base.tps = tps?.tps1m ?? null;
  } catch {
    /* tps unavailable (vanilla) */
  }
  try {
    const host = await getHostResources(server);
    if (host) {
      base.host = {
        process: host.process
          ? { rssBytes: host.process.rssBytes, cpuPercent: host.process.cpuPercent }
          : null,
        disks: host.disks.map((d) => ({
          path: d.path,
          usedPercent: d.usedPercent,
          usedBytes: Math.max(d.totalBytes - d.availableBytes, 0),
          totalBytes: d.totalBytes,
        })),
      };
    }
  } catch {
    /* host metrics stay null */
  }
  return base;
}

/** The all-nulls shape callers fall back to when collection itself throws. */
export function offlineStatus(serverId: string): ServerStatus {
  return {
    id: serverId,
    online: false,
    players: { online: 0, max: 0, names: [] },
    tps: null,
    host: null,
  };
}
