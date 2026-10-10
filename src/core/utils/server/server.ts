/**
 * Multi-server communication layer.
 *
 * Every instance is reached through its API wrapper — this class holds no
 * connection of its own. Before 5.0.0 it also owned an RconClient and a
 * sudo/screen fallback, and each method chose between them and the wrapper
 * at call time; `sendCommand` even preferred RCON over the wrapper when
 * both were configured, so the two paths could disagree about what a
 * server had just been told.
 */
import { log } from "../logger.js";
import {
  serverIsUp,
  stateIsKnown,
  unknownHealth,
  type ServerHealth,
} from "@mcbot/schema/serverState.js";
import {
  UnreachableReason,
  type CommandOutcome,
} from "@mcbot/schema/commandOutcome.js";
import type { ServerCapabilities } from "../../types/index.js";
import { resolveDefaultServerId } from "./guildTargets.js";
import type {
  ServerConfig,
  PlayerCoords,
  ServerListResult,
  TpsResult,
} from "../../types/index.js";
import { errMsg } from "../error.js";
import {
  queryFail,
  queryOk,
  type QueryFailure,
  type QueryResult,
} from "./queryResult.js";
import {
  SEED_BODY,
  entityDataPattern,
  isSignedInt64,
  newestServerMatch,
} from "../minecraft/consoleResponse.js";

// ── ServerInstance ──

const SEED_PATTERN = /Seed:\s*\[(-?\d+)\]/;
const SEED_MISS_TTL_MS = 60_000;
const VERSION_TTL_MS = 10 * 60_000;
const VERSION_MISS_TTL_MS = 60_000;
const LOG_POLL_ATTEMPTS = 3;
const LOG_POLL_INTERVAL_MS = 300;
const LOG_TAIL_LINES = 10;
const COORDS_PATTERN = /\[([\d.+-]+)d,\s*([\d.+-]+)d,\s*([\d.+-]+)d\]/;

function parseSeed(text: string): string | null {
  const seed = text.match(SEED_PATTERN)?.[1];
  return seed && isSignedInt64(seed) ? seed : null;
}

function parseCoords(text: string): PlayerCoords | null {
  const m = text.match(COORDS_PATTERN);
  return m ? { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) } : null;
}

function parseDimension(text: string): string | null {
  return text.match(/"minecraft:([^"]+)"/)?.[1] ?? null;
}

function parseDeathLocation(
  text: string,
): (PlayerCoords & { dimension: string }) | null {
  const pos = text.match(/\[I;\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)\]/);
  if (!pos) return null;
  const dim = text.match(/dimension:\s*"([^"]+)"/);
  return {
    x: Number(pos[1]),
    y: Number(pos[2]),
    z: Number(pos[3]),
    dimension: (dim?.[1] ?? "minecraft:overworld").replace(/^minecraft:/, ""),
  };
}

/** Why a console reply held no usable value. */
function classifyReply(output: string): QueryFailure {
  if (/No entity was found/i.test(output)) return "player-offline";
  if (/Found no elements matching/i.test(output)) return "no-data";
  return "unreadable";
}

export class ServerInstance {
  readonly config: ServerConfig;
  readonly id: string;

  private _seedCache: string | null = null;
  private _seedMiss: { reason: QueryFailure; until: number } | null = null;
  private _versionCache: { value: string | null; until: number } | null = null;

  /**
   * Setup-suite capabilities, probed at startup and re-probed on config
   * reload. `null` means "not probed yet" — gates treat that as fully
   * capable so callers that skip probing (tests) see no difference.
   */
  capabilities: ServerCapabilities | null = null;

  /** Probe and cache which setup-suite artifacts exist for this server. */
  async probeCapabilities(): Promise<ServerCapabilities> {
    const { detectCapabilities } = await import("./serverAccess.js");
    this.capabilities = await detectCapabilities(this.config);
    return this.capabilities;
  }

  constructor(config: ServerConfig) {
    this.config = config;
    this.id = config.id;
  }

  // ── Unified interface ──

  /**
   * Send a console command and say what became of it. Never throws; a
   * command that did not reach the server is logged once, here.
   */
  async send(command: string): Promise<CommandOutcome> {
    let outcome: CommandOutcome;
    try {
      const { sendCommandOutcome } = await import("./serverAccess.js");
      outcome = await sendCommandOutcome(this.config, command);
    } catch (err) {
      outcome = {
        kind: "unreachable",
        reason: UnreachableReason.WrapperDown,
        detail: errMsg(err),
      };
    }
    if (outcome.kind === "unreachable") {
      log.warn(
        this.id,
        `command not delivered (${outcome.reason}): ${outcome.detail}`,
      );
    }
    return outcome;
  }

  /** Temporary shim for callers not yet migrated to `send`. */
  async sendCommand(command: string): Promise<string | null> {
    const outcome = await this.send(command);
    return outcome.kind === "delivered" ? outcome.output : null;
  }

  /**
   * What this server is doing, from whichever channel could tell — the API
   * wrapper, or a direct server-list ping when the wrapper is down.
   *
   * Only `unknown` is retried, and reaching it means *both* channels failed.
   * Any channel that answered has already told us what the server is doing;
   * asking again would not improve the answer, and re-probing a server that
   * is `unresponsive` precisely because it is loaded just adds load. A single
   * dropped packet, though, must not turn into a state change, so a total
   * failure gets one more chance.
   */
  async getHealth(): Promise<ServerHealth> {
    const { getHealth } = await import("./serverAccess.js");
    const RETRY_DELAY_MS = 500;
    let last: ServerHealth = unknownHealth("no attempt made");
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0)
        await new Promise<void>((r) => setTimeout(r, RETRY_DELAY_MS));
      last = await getHealth(this.config);
      if (stateIsKnown(last)) return last;
    }
    log.debug(
      this.id,
      `neither the API wrapper nor a direct ping answered: ${last.reason ?? "unknown"}`,
    );
    return last;
  }

  /**
   * Up in some form — process running, whether or not it is answering.
   *
   * Deliberately false for `unknown`: we established nothing, and a
   * boolean has nowhere to put that. Callers that show state to a human, or
   * decide whether to alert, must use getHealth() instead — this is for the
   * ones that only branch on "can I bother querying it".
   */
  async isRunning(): Promise<boolean> {
    return serverIsUp(await this.getHealth());
  }

  /**
   * A single timeout/network blip here used to be indistinguishable from
   * "server empty" — callers like /daily's online check would silently
   * treat a flaky wrapper response as the player being offline. Retry once,
   * same pattern as getHealth() above, before giving up.
   */
  async getList(): Promise<ServerListResult> {
    const { getList } = await import("./serverAccess.js");
    const RETRY_DELAY_MS = 500;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await getList(this.config);
      } catch {
        if (attempt === 0)
          await new Promise<void>((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
    return { playerCount: "0", maxPlayers: "?", players: [] };
  }

  /**
   * The world seed. A found seed is cached for good; a failure is cached for
   * a minute so a server that cannot answer is not asked on every command.
   */
  async getSeed(): Promise<QueryResult<string>> {
    if (this._seedCache) return queryOk(this._seedCache);
    if (this._seedMiss && Date.now() < this._seedMiss.until) {
      return queryFail(this._seedMiss.reason);
    }
    const result = await this.queryConsole(
      "seed",
      parseSeed,
      SEED_BODY,
      (m) => m[0],
    );
    if (result.ok) {
      this._seedCache = result.value;
      this._seedMiss = null;
    } else {
      this._seedMiss = {
        reason: result.reason,
        until: Date.now() + SEED_MISS_TTL_MS,
      };
    }
    return result;
  }

  /**
   * Run a console command and parse its answer.
   *
   * An RCON reply is authoritative and parsed as is. A command sent with no
   * reply channel only leaves its answer in the server log, so the log is
   * polled, accepting only lines the server itself emitted (see
   * consoleResponse.ts). A command that did not reach the server fails at
   * once: there is nothing to wait for.
   */
  private async queryConsole<T>(
    command: string,
    parse: (text: string) => T | null,
    logBody: RegExp,
    extract: (match: RegExpExecArray) => string,
  ): Promise<QueryResult<T>> {
    const outcome = await this.send(command);
    if (outcome.kind === "unreachable") return queryFail("unreachable");
    if (outcome.kind === "delivered") {
      const value = parse(outcome.output);
      return value !== null
        ? queryOk(value)
        : queryFail(classifyReply(outcome.output));
    }

    const { tailLog } = await import("./serverAccess.js");
    for (let i = 0; i < LOG_POLL_ATTEMPTS; i++) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, LOG_POLL_INTERVAL_MS),
      );
      let tail: string;
      try {
        tail = await tailLog(this.config, LOG_TAIL_LINES);
      } catch (err) {
        log.debug(this.id, `log read failed: ${errMsg(err)}`);
        return queryFail("unreachable");
      }
      const match = newestServerMatch(tail, logBody);
      const value = match ? parse(extract(match)) : null;
      if (value !== null) return queryOk(value);
    }
    return queryFail("unreadable");
  }

  /** The Minecraft version from a status ping, or null when it cannot be read. */
  async getMinecraftVersion(): Promise<string | null> {
    if (this._versionCache && Date.now() < this._versionCache.until) {
      return this._versionCache.value;
    }
    const { pingServer } = await import("./serverAccess.js");
    const { parseVersionName } = await import("../minecraft/versionName.js");
    const ping = await pingServer(this.config);
    const value =
      ping?.kind === "status"
        ? parseVersionName(ping.result.version).minecraftVersion
        : null;
    this._versionCache = {
      value,
      until: Date.now() + (value ? VERSION_TTL_MS : VERSION_MISS_TTL_MS),
    };
    return value;
  }

  /** The raw entity data for one NBT path of an online player. */
  async getPlayerData(
    player: string,
    nbtPath: string,
  ): Promise<QueryResult<string>> {
    return this.queryEntity(player, nbtPath, (text) => text);
  }

  private queryEntity<T>(
    player: string,
    nbtPath: string,
    parse: (text: string) => T | null,
  ): Promise<QueryResult<T>> {
    return this.queryConsole(
      `/data get entity ${player} ${nbtPath}`,
      parse,
      entityDataPattern(player),
      (m) => m[1] ?? "",
    );
  }

  async getPlayerCoords(player: string): Promise<QueryResult<PlayerCoords>> {
    return this.queryEntity(player, "Pos", parseCoords);
  }

  /** The dimension the player is in, e.g. `overworld`, `the_nether`. */
  async getPlayerDimension(player: string): Promise<QueryResult<string>> {
    return this.queryEntity(player, "Dimension", parseDimension);
  }

  /**
   * Where the player last died. Since 1.19 the server stores a
   * LastDeathLocation NBT tag: `{pos: [I; x, y, z], dimension:
   * "minecraft:overworld"}`. `no-data` means the player has not died yet.
   */
  async getLastDeathLocation(
    player: string,
  ): Promise<QueryResult<PlayerCoords & { dimension: string }>> {
    return this.queryEntity(player, "LastDeathLocation", parseDeathLocation);
  }

  /**
   * Whether this instance can provide TPS data. Always true since 5.0.0 —
   * the wrapper answers /tps for every instance. Kept because callers read
   * it to decide whether to render a TPS field at all, and a wrapper that
   * predates the route still degrades to null.
   */
  get supportsTps(): boolean {
    return true;
  }

  /**
   * TPS for this instance.
   *
   * The parsing lives in the wrapper now — it owns the RCON connection, so
   * it is the only side that ever sees a `tps` response. This used to hold
   * a second implementation with its own regexes and a `_hasTpsCommand`
   * cache; both are gone with local mode.
   */
  async getTps(): Promise<TpsResult | null> {
    try {
      const { getTps } = await import("./serverAccess.js");
      return await getTps(this.config);
    } catch {
      return null;
    }
  }
}

// ── ServerManager singleton ──

const instances = new Map<string, ServerInstance>();

export function initServers(serversConfig: Record<string, ServerConfig>): void {
  for (const cfg of Object.values(serversConfig)) {
    addServerInstance(cfg);
  }
}

/**
 * Register a single server instance at runtime.
 * Used by config-reload reconciliation in addition to startup init.
 */
export function addServerInstance(cfg: ServerConfig): ServerInstance {
  const inst = new ServerInstance(cfg);
  instances.set(cfg.id, inst);
  log.info("server", `Initialized server: ${cfg.id} (${cfg.apiUrl})`);
  return inst;
}

/**
 * Drop a server instance from the registry. Watcher teardown is the
 * caller's responsibility (see unwireServer in initMinecraftCommands.ts).
 * The instance itself holds nothing to tear down since 5.0.0 — the RCON
 * socket it used to own now lives in the wrapper.
 */
export function removeServerInstance(serverId: string): ServerInstance | null {
  const inst = instances.get(serverId) ?? null;
  if (!inst) return null;
  instances.delete(serverId);
  log.info("server", `Removed server instance: ${serverId}`);
  return inst;
}

/**
 * Strict lookup: the instance with exactly this ID, or null. No silent
 * fallback — a typo like `/server stop server:survvial` must fail, not
 * stop the first server. Callers that want "any server" semantics use
 * getFirstInstance() explicitly.
 */
export function getServerInstance(serverId: string): ServerInstance | null {
  return instances.get(serverId) ?? null;
}

/** Returns the first registered server instance, or null if none exist. */
export function getFirstInstance(): ServerInstance | null {
  return instances.values().next().value ?? null;
}

export function getAllInstances(): ServerInstance[] {
  return [...instances.values()];
}

/**
 * The server a guild's commands target when they name none. Throws when
 * the guild's `defaultServer` is stale or the choice is ambiguous; see
 * resolveDefaultServerId.
 */
export function getGuildServer(guildId: string | undefined): ServerInstance {
  const id = resolveDefaultServerId(guildId, [...instances.keys()]);
  return instances.get(id)!;
}
