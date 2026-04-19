/**
 * Multi-server communication layer.
 * Each ServerInstance maintains its own RconClient + screen fallback.
 */
import { execSafe, isSudoPermissionError } from "../shell/execCommand.js";
import { log } from "./logger.js";
import { loadConfig } from "../config.js";
import { RconClient } from "../rcon/RconClient.js";
import type {
  ServerConfig,
  PlayerCoords,
  ServerListResult,
  TpsResult,
} from "../types/index.js";

// ── ServerInstance ──

export class ServerInstance {
  readonly config: ServerConfig;
  readonly id: string;

  private _rcon: RconClient | null;
  private _seedCache: string | null = null;
  private _hasTpsCommand: boolean | null = null;

  constructor(config: ServerConfig) {
    this.config = config;
    this.id = config.id;
    this._rcon =
      config.useRcon && config.rconPassword
        ? new RconClient(
            config.rconHost,
            config.rconPort,
            config.rconPassword,
            config.id,
          )
        : null;
  }

  get useRcon(): boolean {
    return this._rcon !== null;
  }

  // ── Screen fallback ──

  private async _screenSend(command: string): Promise<void> {
    const c = this.config;
    const formatted = command.startsWith("/") ? command : `/${command}`;
    const result = await execSafe("sudo", [
      "-n",
      "-u",
      c.linuxUser,
      "screen",
      "-S",
      c.screenSession,
      "-X",
      "stuff",
      `${formatted}\r`,
    ]);
    if (result === null) {
      log.warn(
        this.id,
        `Screen send failed — sudo may not be configured for user '${c.linuxUser}'. ` +
          "See docs/sudoers-setup.md.",
      );
    }
  }

  // ── Unified interface ──

  async sendCommand(command: string): Promise<string | null> {
    if (this._rcon) {
      try {
        const cmd = command.startsWith("/") ? command.slice(1) : command;
        return await this._rcon.send(cmd);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(this.id, `RCON failed, screen fallback: ${message}`);
        await this._screenSend(command);
        return null;
      }
    }

    // Remote server without RCON: route through the API wrapper.
    if (this.config.apiUrl) {
      try {
        const { sendCommand } = await import("./serverAccess.js");
        return await sendCommand(this.config, command);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(this.id, `Remote sendCommand failed: ${message}`);
        return null;
      }
    }

    await this._screenSend(command);
    return null;
  }

  async isRunning(): Promise<boolean> {
    if (this._rcon) {
      // Fast path: a recent successful RCON response is conclusive.
      const RECENT_SUCCESS_MS = 15_000;
      if (Date.now() - this._rcon.lastSuccessTime < RECENT_SUCCESS_MS)
        return true;

      // Retry once before declaring offline so a single blip isn't a false negative.
      const PROBE_TIMEOUT_MS = 3_000;
      const RETRY_DELAY_MS = 500;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0)
          await new Promise<void>((r) => setTimeout(r, RETRY_DELAY_MS));
        try {
          await this._rcon.send("list", PROBE_TIMEOUT_MS);
          return true;
        } catch {
          // continue to next attempt
        }
      }
      return false;
    }

    // Remote server (no RCON): ask the API wrapper directly
    if (this.config.apiUrl) {
      try {
        const { isRunning } = await import("./serverAccess.js");
        return await isRunning(this.config);
      } catch {
        return false;
      }
    }

    // Local server without RCON: check screen session
    const out = await execSafe("sudo", [
      "-n",
      "-u",
      this.config.linuxUser,
      "screen",
      "-list",
    ]);

    if (out !== null && isSudoPermissionError(out)) {
      log.warn(
        this.id,
        `Cannot check screen session — sudo is not configured for user '${this.config.linuxUser}'. ` +
          "See docs/sudoers-setup.md.",
      );
      return false;
    }

    return out
      ? new RegExp(`\\b\\d+\\.${this.config.screenSession}\\b`).test(out)
      : false;
  }

  async getList(): Promise<ServerListResult> {
    if (this._rcon) {
      try {
        const r = await this._rcon.send("list");
        const cm = r.match(
          /There are\s+(\d+)\s*(?:of a max of\s*(\d+)|\/\s*(\d+))\s*players online/i,
        );
        const pm = r.match(/players online:\s*(.*)$/i);
        return {
          playerCount: cm?.[1] ?? "0",
          maxPlayers: cm?.[2] ?? cm?.[3] ?? "?",
          players: pm?.[1]
            ? pm[1]
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
        };
      } catch {
        return { playerCount: "0", maxPlayers: "?", players: [] };
      }
    }
    // Remote server without RCON: ask the API wrapper directly
    if (this.config.apiUrl) {
      try {
        const { getList } = await import("./serverAccess.js");
        return await getList(this.config);
      } catch {
        return { playerCount: "0", maxPlayers: "?", players: [] };
      }
    }

    await this.sendCommand("/list");
    await new Promise<void>((r) => setTimeout(r, 200));
    return { playerCount: "?", maxPlayers: "?", players: [] };
  }

  async getSeed(): Promise<string | null> {
    if (this._seedCache) return this._seedCache;
    if (this._rcon) {
      try {
        const r = await this._rcon.send("seed");
        const m = r.match(/Seed:\s*\[(-?\d+)\]/);
        if (m?.[1]) {
          this._seedCache = m[1];
          return this._seedCache;
        }
      } catch {
        /* fall through to log fallback */
      }
    }
    await this.sendCommand("/seed");
    await new Promise<void>((r) => setTimeout(r, 200));
    const { tailLog } = await import("./serverAccess.js");
    const out = await tailLog(this.config, 10);
    for (const line of out.split("\n").reverse()) {
      const m = line.match(/Seed:\s*\[(-?\d+)\]/);
      if (m?.[1]) {
        this._seedCache = m[1];
        return this._seedCache;
      }
    }
    return null;
  }

  async getPlayerData(player: string, nbtPath: string): Promise<string | null> {
    return await this.sendCommand(`/data get entity ${player} ${nbtPath}`);
  }

  async getPlayerCoords(player: string): Promise<PlayerCoords | null> {
    const r = await this.getPlayerData(player, "Pos");
    if (r) {
      const m = r.match(/\[([\d.+-]+)d,\s*([\d.+-]+)d,\s*([\d.+-]+)d\]/);
      if (m) return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
    }
    await new Promise<void>((r) => setTimeout(r, 200));
    const { tailLog } = await import("./serverAccess.js");
    const out = await tailLog(this.config, 10);
    const m = out.match(/\[([\d.+-]+)d,\s*([\d.+-]+)d,\s*([\d.+-]+)d\]/);
    return m ? { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) } : null;
  }

  async getPlayerDimension(player: string): Promise<string> {
    const r = await this.getPlayerData(player, "Dimension");
    if (r) {
      const m = r.match(/"minecraft:([^"]+)"/);
      if (m?.[1]) return m[1];
    }
    await new Promise<void>((r) => setTimeout(r, 200));
    const { tailLog } = await import("./serverAccess.js");
    const out = await tailLog(this.config, 10);
    const m = out.match(/"minecraft:([^"]+)"/);
    return m?.[1] ?? "overworld";
  }

  /**
   * Whether this instance can provide TPS data.
   * True if connected via direct RCON or via a remote API wrapper.
   */
  get supportsTps(): boolean {
    return this._rcon !== null || Boolean(this.config.apiUrl);
  }

  async getTps(): Promise<TpsResult | null> {
    // Remote server: delegate to API wrapper
    if (this.config.apiUrl) {
      try {
        const { getTps } = await import("./serverAccess.js");
        return await getTps(this.config);
      } catch {
        return null;
      }
    }

    if (!this._rcon) return null;

    // ── Try Paper/Spigot/Purpur "tps" command first ──
    if (this._hasTpsCommand !== false) {
      try {
        const r = await this._rcon.send("tps");
        if (r.toLowerCase().includes("unknown")) {
          // Server does not support this command — permanently skip it.
          this._hasTpsCommand = false;
        } else {
          // Bug 4 fix: anchor after the colon so we don't match stray digits
          // earlier in the response (e.g. colour codes, packet prefixes).
          // Handles both "TPS from last 1m, 5m, 15m: *19.98, *19.99, *20.0"
          // and plain "20.0, 20.0, 20.0" responses.
          const m =
            r.match(/:\s*\*?([\d.]+),\s*\*?([\d.]+),\s*\*?([\d.]+)/) ??
            r.match(/^\s*\*?([\d.]+),\s*\*?([\d.]+),\s*\*?([\d.]+)/m);
          if (m) {
            this._hasTpsCommand = true;
            return {
              tps1m: parseFloat(m[1]!),
              tps5m: parseFloat(m[2]!),
              tps15m: parseFloat(m[3]!),
              raw: r,
            };
          }
        }
      } catch {
        // Bug 1 fix: a network/RCON error does NOT mean the server lacks the
        // tps command — it means the connection blipped. Leave _hasTpsCommand
        // as-is so the next poll retries the command instead of permanently
        // falling back to tick query (which may not exist on Paper servers).
      }
    }

    // ── Fallback: vanilla "tick query" (1.20.3+) ──
    try {
      const r = await this._rcon.send("tick query");
      if (r.toLowerCase().includes("unknown")) return null;

      const msptMatch = r.match(/Average time per tick:\s*([\d.]+)\s*ms/i);
      // Bug 2 fix: return null (not { tps1m: 0 }) when the expected line is
      // missing — a zero TPS value would trigger a false Low TPS alert.
      if (!msptMatch) return null;

      const mspt = parseFloat(msptMatch[1]!);
      const tps = Math.min(20, 1000 / mspt);

      const result: {
        tps1m: number;
        mspt: number;
        raw: string;
        p50?: number;
        p95?: number;
        p99?: number;
      } = { tps1m: tps, mspt, raw: r };

      const p50 = r.match(/P50:\s*([\d.]+)\s*ms/i);
      const p95 = r.match(/P95:\s*([\d.]+)\s*ms/i);
      const p99 = r.match(/P99:\s*([\d.]+)\s*ms/i);
      if (p50?.[1]) result.p50 = parseFloat(p50[1]);
      if (p95?.[1]) result.p95 = parseFloat(p95[1]);
      if (p99?.[1]) result.p99 = parseFloat(p99[1]);

      return result;
    } catch {
      return null;
    }
  }

  // Expose raw RCON for commands that need direct protocol access (e.g. admin tools)
  get rcon(): RconClient | null {
    return this._rcon;
  }
}

// ── ServerManager singleton ──

const instances = new Map<string, ServerInstance>();

export function initServers(serversConfig: Record<string, ServerConfig>): void {
  for (const [id, cfg] of Object.entries(serversConfig)) {
    instances.set(id, new ServerInstance(cfg));
    log.info("server", `Initialized server: ${id} (RCON: ${cfg.useRcon})`);
  }
}

export function getServerInstance(serverId: string): ServerInstance | null {
  return instances.get(serverId) ?? instances.values().next().value ?? null;
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
  return instances.values().next().value ?? null;
}

// ── Backward-compat shims — TO BE REMOVED in Phase 2.2 cleanup ──
// These hard-code the "default" server. All call sites should migrate
// to resolveServer(interaction) from utils/guildRouter.ts instead.

export function getServerConfig(): ServerConfig {
  return getServerInstance("default")?.config ?? ({} as ServerConfig);
}

export async function sendToServer(cmd: string): Promise<string | null> {
  return getServerInstance("default")?.sendCommand(cmd) ?? null;
}

export async function isServerRunning(): Promise<boolean> {
  return getServerInstance("default")?.isRunning() ?? false;
}

export async function getServerSeed(): Promise<string | null> {
  return getServerInstance("default")?.getSeed() ?? null;
}

export async function getServerList(): Promise<ServerListResult> {
  return (
    getServerInstance("default")?.getList() ?? {
      playerCount: "0",
      maxPlayers: "?",
      players: [],
    }
  );
}

export async function getPlayerData(
  p: string,
  n: string,
): Promise<string | null> {
  return getServerInstance("default")?.getPlayerData(p, n) ?? null;
}
