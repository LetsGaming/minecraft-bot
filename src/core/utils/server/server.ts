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
import type { ServerCapabilities } from "../../types/index.js";
import { loadConfig } from "../../config.js";
import type {
  ServerConfig,
  PlayerCoords,
  ServerListResult,
  TpsResult,
} from "../../types/index.js";

// ── ServerInstance ──

export class ServerInstance {
  readonly config: ServerConfig;
  readonly id: string;

  private _seedCache: string | null = null;

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

  async sendCommand(command: string): Promise<string | null> {
    try {
      const { sendCommand } = await import("./serverAccess.js");
      return await sendCommand(this.config, command);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(this.id, `sendCommand failed: ${message}`);
      return null;
    }
  }

  async isRunning(): Promise<boolean> {
    const { isRunning } = await import("./serverAccess.js");
    // A legitimate "not running" comes back as `false` and returns straight
    // away; only a THROWN request error (timeout, a network blip, or a
    // momentarily busy wrapper) is treated as transient and retried, so a
    // single failed request never reports the server as down.
    const RETRY_DELAY_MS = 500;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0)
        await new Promise<void>((r) => setTimeout(r, RETRY_DELAY_MS));
      try {
        return await isRunning(this.config);
      } catch {
        // transient — retry once, then fall through to offline
      }
    }
    return false;
  }

  async getList(): Promise<ServerListResult> {
    try {
      const { getList } = await import("./serverAccess.js");
      return await getList(this.config);
    } catch {
      return { playerCount: "0", maxPlayers: "?", players: [] };
    }
  }

  async getSeed(): Promise<string | null> {
    if (this._seedCache) return this._seedCache;
    const r = await this.sendCommand("seed");
    const m = r?.match(/Seed:\s*\[(-?\d+)\]/);
    if (m?.[1]) {
      this._seedCache = m[1];
      return this._seedCache;
    }
    return null;
  }

  async getPlayerData(player: string, nbtPath: string): Promise<string | null> {
    return await this.sendCommand(`/data get entity ${player} ${nbtPath}`);
  }

  async getPlayerCoords(player: string): Promise<PlayerCoords | null> {
    const r = await this.getPlayerData(player, "Pos");
    if (r !== null) {
      // RCON returned a response — it is authoritative. Parse and return immediately.
      // Falling through to log polling when RCON responded would add up to 900 ms
      // of unnecessary latency without giving us any additional information.
      const m = r.match(/\[([\d.+-]+)d,\s*([\d.+-]+)d,\s*([\d.+-]+)d\]/);
      return m ? { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) } : null;
    }
    // r is null → screen-based server (no RCON response channel); poll the log.
    const { tailLog } = await import("./serverAccess.js");
    for (let i = 0; i < 3; i++) {
      await new Promise<void>((r) => setTimeout(r, 300));
      const out = await tailLog(this.config, 10);
      const m = out.match(/\[([\d.+-]+)d,\s*([\d.+-]+)d,\s*([\d.+-]+)d\]/);
      if (m) return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
    }
    return null;
  }

  async getPlayerDimension(player: string): Promise<string> {
    const r = await this.getPlayerData(player, "Dimension");
    if (r !== null) {
      // RCON response is authoritative — return immediately without log polling.
      const m = r.match(/"minecraft:([^"]+)"/);
      return m?.[1] ?? "overworld";
    }
    // Screen-based server: poll the log for the dimension output.
    const { tailLog } = await import("./serverAccess.js");
    for (let i = 0; i < 3; i++) {
      await new Promise<void>((r) => setTimeout(r, 300));
      const out = await tailLog(this.config, 10);
      const m = out.match(/"minecraft:([^"]+)"/);
      if (m?.[1]) return m[1];
    }
    return "overworld";
  }

  /**
   * Where the player last died. Since 1.19 the server stores a
   * LastDeathLocation NBT tag: `{pos: [I; x, y, z], dimension:
   * "minecraft:overworld"}`. Returns null when the player has no recorded
   * death yet or the data cannot be read (screen fallback with no log
   * match) — same RCON-authoritative / log-polling split as
   * getPlayerCoords above.
   */
  async getLastDeathLocation(
    player: string,
  ): Promise<(PlayerCoords & { dimension: string }) | null> {
    const parse = (
      text: string,
    ): (PlayerCoords & { dimension: string }) | null => {
      const pos = text.match(/\[I;\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)\]/);
      if (!pos) return null;
      const dim = text.match(/dimension:\s*"([^"]+)"/);
      return {
        x: Number(pos[1]),
        y: Number(pos[2]),
        z: Number(pos[3]),
        dimension: (dim?.[1] ?? "minecraft:overworld").replace(
          /^minecraft:/,
          "",
        ),
      };
    };

    const r = await this.getPlayerData(player, "LastDeathLocation");
    if (r !== null) return parse(r);

    // Screen-based server: poll the log for the data output.
    const { tailLog } = await import("./serverAccess.js");
    for (let i = 0; i < 3; i++) {
      await new Promise<void>((res) => setTimeout(res, 300));
      const out = await tailLog(this.config, 10);
      const parsed = parse(out);
      if (parsed) return parsed;
    }
    return null;
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

export function getGuildServer(
  guildId: string | undefined,
): ServerInstance | null {
  if (!guildId) return null;
  const cfg = loadConfig();
  const guild = cfg.guilds[guildId];
  if (guild?.defaultServer) {
    const inst = instances.get(guild.defaultServer);
    if (inst) return inst;
  }
  return getFirstInstance();
}
