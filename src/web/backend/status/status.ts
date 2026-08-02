/**
 * Live per-server status collection (phase 1), shared by the /api/status
 * route and the Prometheus exposition — both must produce the same
 * numbers, so there is exactly one collector.
 *
 * Split out of server.ts in the QUAL-01 refactor (2026-07 audit).
 */
import { getServerInstance } from "@mcbot/core/utils/server/server.js";
import { getHostResources } from "@mcbot/core/utils/server/hostResources.js";
import {
  getRemoteManifest,
  detectCapabilities,
} from "@mcbot/core/utils/server/serverAccess.js";
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

  // Probed before every early return below, because what the WRAPPER can do
  // is independent of whether the Minecraft server is running. Assigning this
  // further down meant a stopped or unresponsive server reported no features
  // at all — so the Backups tab disappeared exactly when someone would want to
  // restore one.
  base.features = await wrapperFeatures(server);

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
 * What this server's wrapper says it can do.
 *
 * The dashboard has to ask the wrapper itself. `ServerInstance.capabilities`
 * is filled by `probeCapabilities()`, which only the BOT process calls — the
 * dashboard runs as its own process and shares nothing but config.json, so
 * reading that field here returns null forever and every feature-gated
 * control disappears. (That is exactly what happened: the Backups tab was
 * hidden on every host because this asked the wrong side.)
 *
 * Two sources, because they answer different questions:
 *   detectCapabilities  — which suite scripts exist on this host
 *   the manifest        — which ROUTES this wrapper serves, generated from
 *                         its real router, so it cannot claim a feature the
 *                         process does not have
 *
 * Cached per server, because the status view polls every 15 s and this only
 * changes when the wrapper or the suite is redeployed.
 */
const featureCache = new Map<string, { at: number; value: ServerStatus["features"] }>();
const FEATURE_TTL_MS = 5 * 60_000;

/**
 * Forget what the wrapper said it can do.
 *
 * Needed whenever a server's config changes under us — a new apiUrl or a
 * redeployed wrapper would otherwise keep answering from a five-minute-old
 * probe. Tests use it for isolation; `/config reload` should call it too.
 */
export function clearFeatureCache(): void {
  featureCache.clear();
}

async function wrapperFeatures(server: {
  id: string;
  config: Parameters<typeof getRemoteManifest>[0];
}): Promise<ServerStatus["features"]> {
  const hit = featureCache.get(server.id);
  if (hit && Date.now() - hit.at < FEATURE_TTL_MS) return hit.value;

  let value: ServerStatus["features"] = null;
  try {
    const [caps, manifest] = await Promise.all([
      detectCapabilities(server.config),
      getRemoteManifest(server.config),
    ]);
    value = {
      scripts: { ...caps.scripts },
      restore: caps.restore ?? false,
      backupFiles: manifest?.features?.["backup-files"] !== undefined,
    };
  } catch {
    // Null means "could not ask", NOT "does not have it". An unreachable
    // wrapper is temporary and the status card already says so; hiding half
    // the UI on top of that just makes an outage look like a regression.
    value = null;
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
