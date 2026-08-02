/**
 * Live per-server status collection (phase 1), shared by the /api/status
 * route and the Prometheus exposition — both must produce the same
 * numbers, so there is exactly one collector.
 *
 * Split out of server.ts in the QUAL-01 refactor (2026-07 audit).
 */
import { getServerInstance } from "@mcbot/core/utils/server/server.js";
import { getHostResources } from "@mcbot/core/utils/server/hostResources.js";
import { getRemoteManifest } from "@mcbot/core/utils/server/serverAccess.js";
import {
  HealthSource,
  RconState,
  ServerState,
  WrapperState,
  canQueryServer,
} from "@mcbot/schema/serverState.js";
import type { ServerStatus } from "@mcbot/schema/contract.js";

export async function collectStatus(serverId: string): Promise<ServerStatus> {
  const server = getServerInstance(serverId);
  if (!server) throw new Error(`unknown server ${serverId}`);

  const health = await server.getHealth();
  const base: ServerStatus = {
    id: serverId,
    state: health.state,
    rcon: health.rcon,
    wrapper: health.wrapper,
    source: health.source,
    online: health.state === ServerState.Online,
    // A direct ping supplies counts even with the wrapper down, so take
    // whatever the answering channel managed to give us before deciding
    // there is nothing to show.
    players: health.players
      ? {
          online: health.players.online,
          max: health.players.max,
          names: health.players.names,
          sampled: health.players.sampled,
        }
      : { online: 0, max: 0, names: [], sampled: false },
    tps: null,
    features: null,
    host: null,
  };

  // Everything below goes through the wrapper, so there is nothing more to
  // collect without it — the ping's player counts are already in `base`.
  if (health.wrapper !== WrapperState.Up) return base;

  // An unresponsive server is up but not answering commands, so asking it for
  // a player list, TPS or host metrics only produces zeros. The UI renders the
  // state instead of pretending to numbers.
  if (!canQueryServer(health)) return base;

  try {
    const list = await server.getList();
    base.players = {
      online: parseInt(String(list.playerCount), 10) || 0,
      max: parseInt(String(list.maxPlayers), 10) || 0,
      names: list.players ?? [],
      // The wrapper reads the real roster over RCON — not a sample.
      sampled: false,
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
    // Capabilities come from the wrapper's own probe, so an instance without
    // the suite installed reports the missing scripts rather than offering
    // buttons that 409 at use. `backupFiles` additionally needs a wrapper new
    // enough to serve the index, which the capability probe cannot say — the
    // manifest can, so an older wrapper simply reports false and the panel
    // stays hidden instead of erroring on open.
    const caps = server.capabilities;
    if (caps) {
      base.features = {
        scripts: { ...caps.scripts },
        restore: caps.restore ?? false,
        backupFiles: await wrapperHasBackupFiles(server),
      };
    }
  } catch {
    /* features stay null */
  }
  try {
    const host = await getHostResources(server);
    if (host) {
      base.host = {
        process: host.process
          ? { rssBytes: host.process.rssBytes, cpuPercent: host.process.cpuPercent }
          : null,
        machine: host.machine,
        disks: host.disks.map((d) => ({
          path: d.path,
          sizeBytes: d.sizeBytes,
          mountPoint: d.filesystem.mountPoint,
          usedPercent: d.filesystem.usedPercent,
          usedBytes: Math.max(
            d.filesystem.totalBytes - d.filesystem.availableBytes,
            0,
          ),
          totalBytes: d.filesystem.totalBytes,
        })),
      };
    }
  } catch {
    /* host metrics stay null */
  }
  return base;
}

/**
 * The shape callers fall back to when collection itself throws.
 *
 * `unreachable`, not `offline`: reaching this means the bot's own status pass
 * broke, which says nothing whatsoever about the Minecraft server. Naming it
 * "offline" is how a dashboard error became a server-down report.
 */
/**
 * Does this server's wrapper serve the archive index and download?
 *
 * Read from the manifest rather than inferred from a version compare: the
 * manifest is generated from the wrapper's real router, so it cannot claim a
 * feature the process does not serve. A wrapper too old to have a manifest
 * answers null here, which is the correct "no" — those predate the feature.
 *
 * Cached per server for the poll interval, because the status view refreshes
 * every 15 s and this answer changes only when the wrapper is redeployed.
 */
const featureCache = new Map<string, { at: number; value: boolean }>();
const FEATURE_TTL_MS = 5 * 60_000;

async function wrapperHasBackupFiles(server: {
  id: string;
  config: Parameters<typeof getRemoteManifest>[0];
}): Promise<boolean> {
  const hit = featureCache.get(server.id);
  if (hit && Date.now() - hit.at < FEATURE_TTL_MS) return hit.value;

  let value = false;
  try {
    const manifest = await getRemoteManifest(server.config);
    value = manifest?.features?.["backup-files"] !== undefined;
  } catch {
    value = false;
  }
  featureCache.set(server.id, { at: Date.now(), value });
  return value;
}

export function unknownStatus(serverId: string): ServerStatus {
  return {
    id: serverId,
    state: ServerState.Unknown,
    rcon: RconState.Unknown,
    wrapper: WrapperState.Unreachable,
    source: HealthSource.None,
    online: false,
    players: { online: 0, max: 0, names: [], sampled: false },
    tps: null,
    features: null,
    host: null,
  };
}
