/**
 * Multi-server communication layer.
 * Each ServerInstance maintains its own RCON connection + screen fallback.
 */
import net from "net";
import { execCommand } from "../shell/execCommand.js";
import { log } from "./logger.js";
import { loadConfig } from "../config.js";
import type {
  ServerConfig,
  PlayerCoords,
  ServerListResult,
  TpsResult,
  RconPacket,
  PendingRconCommand,
} from "../types/index.js";

// ── RCON Protocol ──

const RCON_PACKET_TYPE = {
  AUTH: 3,
  AUTH_RESP: 2,
  CMD: 2,
} as const;

function encodePkt(id: number, type: number, body: string): Buffer {
  const b = Buffer.from(body, "utf-8");
  const len = 4 + 4 + b.length + 2;
  const buf = Buffer.alloc(4 + len);
  buf.writeInt32LE(len, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  b.copy(buf, 12);
  buf[12 + b.length] = 0;
  buf[13 + b.length] = 0;
  return buf;
}

function decodePkt(buf: Buffer): RconPacket | null {
  if (buf.length < 14) return null;
  const length = buf.readInt32LE(0);
  if (buf.length < 4 + length) return null;
  return {
    id: buf.readInt32LE(4),
    type: buf.readInt32LE(8),
    body: buf.toString("utf-8", 12, 4 + length - 2),
    totalSize: 4 + length,
  };
}

// ── ServerInstance ──

export class ServerInstance {
  readonly config: ServerConfig;
  readonly id: string;

  private _client: net.Socket | null = null;
  private _auth = false;
  private _connecting = false;
  private _cmdId = 10;
  private _pending = new Map<number, PendingRconCommand>();
  private _buf = Buffer.alloc(0);
  private _authResolve: (() => void) | null = null;
  private _authReject: ((err: Error) => void) | null = null;
  private _seedCache: string | null = null;
  private _hasTpsCommand: boolean | null = null;
  private _lastRconSuccess = 0;

  constructor(config: ServerConfig) {
    this.config = config;
    this.id = config.id;
  }

  get useRcon(): boolean {
    return this.config.useRcon && !!this.config.rconPassword;
  }

  // ── RCON persistent connection ──

  private _cleanup(): void {
    this._auth = false;
    this._connecting = false;
    if (this._client) {
      this._client.removeAllListeners();
      this._client.destroy();
      this._client = null;
    }
    for (const [, cb] of this._pending) {
      clearTimeout(cb.timer);
      cb.reject(new Error("RCON lost"));
    }
    this._pending.clear();
    this._buf = Buffer.alloc(0);
    if (this._authReject) {
      this._authReject(new Error("RCON lost"));
      this._authResolve = null;
      this._authReject = null;
    }
  }

  private _connect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this._auth && this._client && !this._client.destroyed)
        return resolve();
      if (this._connecting) {
        const w = setInterval(() => {
          if (this._auth) {
            clearInterval(w);
            resolve();
          }
          if (!this._connecting) {
            clearInterval(w);
            reject(new Error("RCON failed"));
          }
        }, 50);
        return;
      }
      this._cleanup();
      this._connecting = true;
      this._authResolve = resolve;
      this._authReject = reject;
      const c = this.config;
      this._client = new net.Socket();
      this._client.setKeepAlive(true, 30000);
      const t = setTimeout(() => {
        this._cleanup();
        reject(new Error("RCON auth timeout"));
      }, 10000);
      this._client.connect(c.rconPort, c.rconHost, () => {
        this._client!.write(
          encodePkt(1, RCON_PACKET_TYPE.AUTH, c.rconPassword),
        );
      });
      this._client.on("data", (data: Buffer) => {
        this._buf = Buffer.concat([this._buf, data]);
        while (true) {
          const p = decodePkt(this._buf);
          if (!p) break;
          this._buf = this._buf.subarray(p.totalSize);
          if (!this._auth) {
            clearTimeout(t);
            if (p.id === -1) {
              this._connecting = false;
              this._cleanup();
              reject(new Error("RCON auth failed"));
              return;
            }
            if (p.id === 1) {
              this._auth = true;
              this._connecting = false;
              if (this._authResolve) {
                this._authResolve();
                this._authResolve = null;
                this._authReject = null;
              }
            }
            continue;
          }
          const cb = this._pending.get(p.id);
          if (cb) {
            clearTimeout(cb.timer);
            this._pending.delete(p.id);
            this._lastRconSuccess = Date.now();
            cb.resolve(p.body);
          }
        }
      });
      this._client.on("error", () => this._cleanup());
      this._client.on("close", () => this._cleanup());
    });
  }

  async rcon(command: string, timeoutMs = 5000): Promise<string> {
    await this._connect();
    const id = this._cmdId++;
    if (this._cmdId > 2e9) this._cmdId = 10;
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error("RCON timeout"));
      }, timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      this._client!.write(encodePkt(id, RCON_PACKET_TYPE.CMD, command));
    });
  }

  // ── Screen fallback ──

  private async _screenSend(command: string): Promise<void> {
    const c = this.config;
    const formatted = command.startsWith("/") ? command : `/${command}`;
    await execCommand(
      `sudo -u ${c.linuxUser} screen -S ${c.screenSession} -X stuff "${formatted}$(printf '\\r')"`,
    );
  }

  // ── Unified interface ──

  async sendCommand(command: string): Promise<string | null> {
    if (this.useRcon) {
      try {
        const cmd = command.startsWith("/") ? command.slice(1) : command;
        return await this.rcon(cmd);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(this.id, `RCON failed, screen fallback: ${message}`);
        await this._screenSend(command);
        return null;
      }
    }
    await this._screenSend(command);
    return null;
  }

  async isRunning(): Promise<boolean> {
    if (this.useRcon) {
      // Fast path: a recent successful RCON response is conclusive — skip the probe.
      // 15s is short enough not to mask a real outage, but covers the common case
      // of multiple callers (e.g. statusEmbed, tpsMonitor) firing close together.
      const RECENT_SUCCESS_MS = 15_000;
      if (Date.now() - this._lastRconSuccess < RECENT_SUCCESS_MS) return true;

      // Probe path: a single RCON call can transiently time out (GC pause, brief
      // load spike) even when the server is fully healthy. Retry once before
      // declaring offline so one blip cannot produce a false negative.
      const PROBE_TIMEOUT_MS = 3_000;
      const RETRY_DELAY_MS = 500;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (attempt > 0)
          await new Promise<void>((r) => setTimeout(r, RETRY_DELAY_MS));
        try {
          await this.rcon("list", PROBE_TIMEOUT_MS);
          return true;
        } catch {
          // continue to next attempt
        }
      }
      return false;
    }

    const out = await execCommand(
      `sudo -u ${this.config.linuxUser} screen -list`,
    );
    return out
      ? new RegExp(`\\b\\d+\\.${this.config.screenSession}\\b`).test(out)
      : false;
  }

  async getList(): Promise<ServerListResult> {
    if (this.useRcon) {
      try {
        const r = await this.rcon("list");
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
    // Screen fallback
    await this.sendCommand("/list");
    await new Promise<void>((r) => setTimeout(r, 200));
    return { playerCount: "?", maxPlayers: "?", players: [] };
  }

  async getSeed(): Promise<string | null> {
    if (this._seedCache) return this._seedCache;
    if (this.useRcon) {
      try {
        const r = await this.rcon("seed");
        const m = r.match(/Seed:\s*\[(-?\d+)\]/);
        if (m?.[1]) {
          this._seedCache = m[1];
          return this._seedCache;
        }
      } catch {
        /* fall through */
      }
    }
    await this.sendCommand("/seed");
    await new Promise<void>((r) => setTimeout(r, 200));
    const { getLatestLogs } = await import("./utils.js");
    const out = await getLatestLogs(10, this.config.serverDir);
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
    const { getLatestLogs } = await import("./utils.js");
    const out = await getLatestLogs(10, this.config.serverDir);
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
    const { getLatestLogs } = await import("./utils.js");
    const out = await getLatestLogs(10, this.config.serverDir);
    const m = out.match(/"minecraft:([^"]+)"/);
    return m?.[1] ?? "overworld";
  }

  async getTps(): Promise<TpsResult | null> {
    if (!this.useRcon) return null;

    // ── Try Paper/Spigot/Purpur "tps" command first ──
    if (this._hasTpsCommand !== false) {
      try {
        const r = await this.rcon("tps");
        if (!r.toLowerCase().includes("unknown")) {
          const m = r.match(/([\d.]+)(?:,\s*([\d.]+)(?:,\s*([\d.]+))?)?/);
          if (m) {
            this._hasTpsCommand = true;
            return {
              tps1m: parseFloat(m[1]!),
              tps5m: parseFloat(m[2] ?? m[1]!),
              tps15m: parseFloat(m[3] ?? m[1]!),
              raw: r,
            };
          }
        }
      } catch {
        this._hasTpsCommand = false;
      }
    }

    // ── Fallback: vanilla "tick query" (1.20.3+) ──
    try {
      const r = await this.rcon("tick query");
      if (r.toLowerCase().includes("unknown")) return null;

      const msptMatch = r.match(/Average time per tick:\s*([\d.]+)\s*ms/i);
      if (!msptMatch) return { tps1m: 0, raw: r };

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

// ── Backward-compat re-exports for commands that don't specify a server ──

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

/**
 * Get the default ServerInstance for a guild, or the first available instance.
 * Uses the guild's `defaultServer` config to pick the right one.
 */
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
