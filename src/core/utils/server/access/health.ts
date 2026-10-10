/** Server health from the wrapper, with a direct game-port ping as a second opinion. */

import { log } from "../../logger.js";
import { isRecord } from "../../objects.js";
import {
  HealthSource,
  RconState,
  ServerState,
  WrapperState,
  unknownHealth,
  type ServerHealth,
} from "@mcbot/schema/serverState.js";
import { DEFAULT_MINECRAFT_PORT, pingMinecraftServer, type PingOutcome } from "../serverPing.js";
import type { ServerConfig, TpsResult } from "../../../types/index.js";
import type { WireSchemas } from "@mcbot/schema/wire/index.js";
import { apiGetRaw, readApiJson, apiGet } from "./apiClient.js";

/**
 * Health gets a tighter budget than everything else. It is polled on a loop
 * and its whole purpose is to answer quickly enough to be worth asking — and
 * the wrapper's own probes are bounded well below this, so anything slower is
 * the network or a wedged wrapper, which is precisely the `unreachable` case
 * we want to report rather than wait out.
 */
const HEALTH_TIMEOUT_MS = 5_000;

/** The wrapper's `/health` body. `restartCount` and `unitFailed` are absent on a v1 wrapper. */
type WrapperHealth = Omit<WireSchemas["InstanceHealth"], "restartCount" | "unitFailed"> &
  Partial<Pick<WireSchemas["InstanceHealth"], "restartCount" | "unitFailed">>;

/**
 * Narrow a `/health` body instead of casting it.
 *
 * Every other wrapper response is cast, because the version gate pins the
 * contract. This one is different: its `state` flows straight into alerting
 * and UI branches, so a wrapper that answered `"Online"`, `"up"`, or a state
 * added in a later version would silently fall through every comparison and
 * land wherever the last `else` happens to point. Unrecognised input becomes
 * an explicit failure to parse, which the caller reports honestly.
 */
function parseWrapperHealth(body: unknown): ServerHealth | null {
  if (!isRecord(body)) return null;
  const { state, processUp, probe, rcon, checkedAt, restartCount, unitFailed } = body;
  if (
    state !== ServerState.Online &&
    state !== ServerState.Unresponsive &&
    state !== ServerState.Offline
  ) {
    return null;
  }
  if (typeof processUp !== "boolean") return null;
  if (!isRecord(rcon)) return null;

  return {
    state,
    source: HealthSource.Wrapper,
    wrapper: WrapperState.Up,
    processUp,
    rcon: !rcon.configured
      ? RconState.Unconfigured
      : rcon.responsive === true
        ? RconState.Responsive
        : RconState.Unresponsive,
    probe: typeof probe === "string" ? probe : null,
    players: null,
    reason: null,
    checkedAt: typeof checkedAt === "number" ? checkedAt : Date.now(),
    restartCount: typeof restartCount === "number" ? restartCount : 0,
    unitFailed: unitFailed === true,
  };
}

/**
 * Where to ping this server, when the wrapper cannot be asked.
 *
 * Explicit config wins. Otherwise the host comes from `apiUrl` — the wrapper
 * runs *on* the Minecraft host, which is the whole reason that URL points at
 * the right machine — and the port from whatever the wrapper last reported,
 * falling back to the vanilla default.
 */
const learnedGamePorts = new Map<string, number>();

/** Drop what was learned about a server's game port (removed or re-pointed server). */
export function forgetGamePort(serverId: string): void {
  learnedGamePorts.delete(serverId);
}

/** Remember a `gamePort` so it is still known once the wrapper goes away. */
export function rememberGamePort(serverId: string, port: number | null): void {
  if (typeof port === "number" && port > 0 && port < 65536) {
    learnedGamePorts.set(serverId, port);
  }
}

export function pingTarget(
  cfg: ServerConfig,
): { host: string; port: number } | null {
  const port =
    cfg.pingPort ?? learnedGamePorts.get(cfg.id) ?? DEFAULT_MINECRAFT_PORT;
  if (cfg.pingHost) return { host: cfg.pingHost, port };
  try {
    return { host: new URL(cfg.apiUrl).hostname, port };
  } catch {
    return null;
  }
}

/**
 * Ask the Minecraft server directly. Returns null when pinging is switched off
 * or there is nowhere to send it.
 */
export async function pingServer(
  cfg: ServerConfig,
): Promise<PingOutcome | null> {
  if (cfg.disableDirectPing) return null;
  const target = pingTarget(cfg);
  if (!target) return null;
  return pingMinecraftServer(target.host, target.port);
}

/**
 * Turn a ping outcome into a health value.
 *
 * `wrapper` is supplied by the caller because a ping says nothing about the
 * wrapper — that is exactly the separation this whole model exists to keep.
 */
function healthFromPing(
  outcome: PingOutcome,
  wrapper: WrapperState,
  rcon: RconState,
): ServerHealth {
  const base = {
    source: HealthSource.Ping,
    wrapper,
    rcon,
    probe: "ping",
    checkedAt: Date.now(),
    // A ping can't see systemd — always nothing-to-report on this channel.
    restartCount: 0,
    unitFailed: false,
  };

  switch (outcome.kind) {
    case "status":
      // The server answered a client handshake with a live player count. It
      // is up and serving connections, whatever the wrapper thinks.
      return {
        ...base,
        state: ServerState.Online,
        processUp: true,
        players: {
          online: outcome.result.players.online,
          max: outcome.result.players.max,
          names: outcome.result.players.sample,
          // Servers publish at most a handful of names, so this is never the
          // roster — anything rendering it has to say so.
          sampled: true,
        },
        reason: null,
      };

    case "connected":
      // Something is listening but not answering: status disabled, still
      // starting, or a proxy in front. Life, not health.
      return {
        ...base,
        state: ServerState.Unresponsive,
        processUp: true,
        players: null,
        reason: "game port accepted the connection but sent no status",
      };

    case "refused":
      return {
        ...base,
        state: ServerState.Offline,
        processUp: false,
        players: null,
        reason: outcome.reason,
      };

    case "error":
      return {
        ...base,
        state: ServerState.Unknown,
        source: HealthSource.None,
        processUp: false,
        players: null,
        reason: outcome.reason,
      };
  }
}

/**
 * What a server is doing, from whichever channel can say.
 *
 * The wrapper is asked first — it has the richest answer, including RCON
 * responsiveness, which a ping cannot see. But the wrapper is a separate
 * process, and when it is down the old code gave up entirely: "the server's
 * state is unknown", for a server a player could see in their multiplayer
 * list with four people on it.
 *
 * So a direct ping is a **second opinion, consulted whenever the first is
 * anything other than "all good"**. That covers the case above and two more:
 *
 *   - the wrapper reports `offline` while the server answers a ping. The
 *     server wins — a status response is proof, and the wrapper's probes are
 *     inference. It also means the wrapper is misconfigured, which is worth
 *     saying out loud.
 *   - the wrapper reports `unresponsive` (RCON is not answering). The ping
 *     cannot fix that, but it can still supply the player count, so the state
 *     stays honest while the numbers come back.
 *
 * `unknown` now means both channels failed, which is a much smaller claim
 * than the one it replaced.
 */
export async function getHealth(cfg: ServerConfig): Promise<ServerHealth> {
  const fromWrapper = await wrapperHealth(cfg);

  // The wrapper answered and everything is fine — nothing to second-guess.
  if (
    fromWrapper &&
    fromWrapper.state === ServerState.Online &&
    fromWrapper.wrapper === WrapperState.Up
  ) {
    return fromWrapper;
  }

  const wrapperState = fromWrapper ? WrapperState.Up : WrapperState.Unreachable;
  const outcome = await pingServer(cfg);

  // Pinging is off, or there is nowhere to ping. Fall back to whatever the
  // wrapper managed to say.
  if (!outcome) {
    return fromWrapper ?? unknownHealth("API wrapper unreachable; direct ping unavailable");
  }

  const fromPing = healthFromPing(
    outcome,
    wrapperState,
    fromWrapper?.rcon ?? RconState.Unknown,
  );

  if (!fromWrapper) return fromPing;

  // Both spoke. The wrapper's verdict stands unless the ping positively
  // contradicts it, because only a status response is direct evidence.
  if (
    fromWrapper.state === ServerState.Offline &&
    fromPing.state === ServerState.Online
  ) {
    log.warn(
      cfg.id,
      `API wrapper reports this server stopped, but it answered a direct ` +
        `server-list ping with ${fromPing.players?.online ?? "?"} player(s) ` +
        `online. Trusting the ping. Check the wrapper's instance config — ` +
        `linuxUser, rconPort and the screen session name are what its ` +
        `liveness probes rely on.`,
    );
    return fromPing;
  }

  // Keep the wrapper's richer verdict, but take the players the ping found.
  return { ...fromWrapper, players: fromPing.players ?? fromWrapper.players };
}

/**
 * The wrapper's half of getHealth: its verdict, or null when it did not
 * answer at all. Never throws.
 */
async function wrapperHealth(cfg: ServerConfig): Promise<ServerHealth | null> {
  try {
    const res = await apiGetRaw(cfg, "/health", HEALTH_TIMEOUT_MS);

    if (res.status === 404) {
      // Pre-`server-health` wrapper. /running is all it has, and on those
      // versions it answers the RCON question rather than the process one —
      // so this path keeps the old (coarser) behaviour rather than inventing
      // a distinction the wrapper cannot make. The startup contract report
      // already tells the operator to update.
      const { running } = await apiGet<{ running: boolean }>(cfg, "/running");
      return {
        state: running ? ServerState.Online : ServerState.Offline,
        source: HealthSource.Wrapper,
        wrapper: WrapperState.Up,
        processUp: running,
        rcon: RconState.Unknown,
        probe: null,
        players: null,
        reason: null,
        checkedAt: Date.now(),
        restartCount: 0,
        unitFailed: false,
      };
    }

    const body = await readApiJson<WrapperHealth>(res, "/health");
    // Learn the game port while we can, so a ping still works after the
    // wrapper goes away — which is precisely when it is needed.
    rememberGamePort(cfg.id, body.gamePort ?? null);
    return parseWrapperHealth(body);
  } catch {
    return null;
  }
}

/**
 * Legacy boolean liveness.
 *
 * Kept for the wrapper-contract e2e check and for callers that genuinely only
 * need up/not-up. Anything that reports state to a human should use
 * getHealth() — this cannot distinguish a stopped server from an unreachable
 * wrapper, which is exactly the confusion users see.
 */
export async function isRunning(cfg: ServerConfig): Promise<boolean> {
  const { running } = await apiGet<{ running: boolean }>(cfg, "/running");
  return running;
}

/** Get the current player list. */
export async function getList(
  cfg: ServerConfig,
): Promise<{ playerCount: string; maxPlayers: string; players: string[] }> {
  return apiGet(cfg, "/list");
}

/** Get TPS data from the server. Returns null if unavailable. */
export async function getTps(cfg: ServerConfig): Promise<TpsResult | null> {
  const { tps } = await apiGet<{
    tps: TpsResult | null;
  }>(cfg, "/tps");
  return tps;
}
