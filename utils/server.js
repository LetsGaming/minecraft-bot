/**
 * Multi-server communication layer.
 * Each ServerInstance maintains its own RCON connection + screen fallback.
 * ServerManager holds all instances, keyed by server ID.
 */
import net from "net";
import { execCommand, execSafe } from "../shell/execCommand.js";
import { log } from "./logger.js";

// ── RCON Protocol ──
const PKT = { AUTH: 3, AUTH_RESP: 2, CMD: 2 };

function encodePkt(id, type, body) {
  const b = Buffer.from(body, "utf-8");
  const len = 4 + 4 + b.length + 2;
  const buf = Buffer.alloc(4 + len);
  buf.writeInt32LE(len, 0); buf.writeInt32LE(id, 4); buf.writeInt32LE(type, 8);
  b.copy(buf, 12); buf[12 + b.length] = 0; buf[13 + b.length] = 0;
  return buf;
}

function decodePkt(buf) {
  if (buf.length < 14) return null;
  const length = buf.readInt32LE(0);
  if (buf.length < 4 + length) return null;
  return { id: buf.readInt32LE(4), type: buf.readInt32LE(8),
    body: buf.toString("utf-8", 12, 4 + length - 2), totalSize: 4 + length };
}

// ── ServerInstance ──

export class ServerInstance {
  constructor(config) {
    this.config = config;
    this.id = config.id;
    this._client = null; this._auth = false; this._connecting = false;
    this._cmdId = 10; this._pending = new Map(); this._buf = Buffer.alloc(0);
    this._authResolve = null; this._authReject = null;
    this._seedCache = null;
  }

  get useRcon() { return this.config.useRcon && !!this.config.rconPassword; }

  // ── RCON persistent connection ──
  _cleanup() {
    this._auth = false; this._connecting = false;
    if (this._client) { this._client.removeAllListeners(); this._client.destroy(); this._client = null; }
    for (const [, cb] of this._pending) { clearTimeout(cb.timer); cb.reject(new Error("RCON lost")); }
    this._pending.clear(); this._buf = Buffer.alloc(0);
    if (this._authReject) { this._authReject(new Error("RCON lost")); this._authResolve = null; this._authReject = null; }
  }

  _connect() {
    return new Promise((resolve, reject) => {
      if (this._auth && this._client && !this._client.destroyed) return resolve();
      if (this._connecting) {
        const w = setInterval(() => {
          if (this._auth) { clearInterval(w); resolve(); }
          if (!this._connecting) { clearInterval(w); reject(new Error("RCON failed")); }
        }, 50);
        return;
      }
      this._cleanup(); this._connecting = true;
      this._authResolve = resolve; this._authReject = reject;
      const c = this.config;
      this._client = new net.Socket();
      this._client.setKeepAlive(true, 30000);
      const t = setTimeout(() => { this._cleanup(); reject(new Error("RCON auth timeout")); }, 10000);
      this._client.connect(c.rconPort, c.rconHost, () => {
        this._client.write(encodePkt(1, PKT.AUTH, c.rconPassword));
      });
      this._client.on("data", (data) => {
        this._buf = Buffer.concat([this._buf, data]);
        while (true) {
          const p = decodePkt(this._buf);
          if (!p) break;
          this._buf = this._buf.slice(p.totalSize);
          if (!this._auth) {
            clearTimeout(t);
            if (p.id === -1) { this._connecting = false; this._cleanup(); reject(new Error("RCON auth failed")); return; }
            if (p.id === 1) { this._auth = true; this._connecting = false; if (this._authResolve) { this._authResolve(); this._authResolve = null; this._authReject = null; } }
            continue;
          }
          const cb = this._pending.get(p.id);
          if (cb) { clearTimeout(cb.timer); this._pending.delete(p.id); cb.resolve(p.body); }
        }
      });
      this._client.on("error", () => this._cleanup());
      this._client.on("close", () => this._cleanup());
    });
  }

  async rcon(command, timeoutMs = 5000) {
    await this._connect();
    const id = this._cmdId++;
    if (this._cmdId > 2e9) this._cmdId = 10;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this._pending.delete(id); reject(new Error("RCON timeout")); }, timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      this._client.write(encodePkt(id, PKT.CMD, command));
    });
  }

  // ── Screen fallback ──
  async _screenSend(command) {
    const c = this.config;
    const formatted = command.startsWith("/") ? command : `/${command}`;
    await execCommand(`sudo -u ${c.linuxUser} screen -S ${c.screenSession} -X stuff "${formatted}$(printf '\\r')"`);
  }

  // ── Unified interface ──
  async sendCommand(command) {
    if (this.useRcon) {
      try {
        const cmd = command.startsWith("/") ? command.slice(1) : command;
        return await this.rcon(cmd);
      } catch (err) {
        log.warn(this.id, `RCON failed, screen fallback: ${err.message}`);
        await this._screenSend(command);
        return null;
      }
    }
    await this._screenSend(command);
    return null;
  }

  async isRunning() {
    if (this.useRcon) {
      try { await this.rcon("list"); return true; } catch { return false; }
    }
    const out = await execCommand(`sudo -u ${this.config.linuxUser} screen -list`);
    return out ? new RegExp(`\\b\\d+\\.${this.config.screenSession}\\b`).test(out) : false;
  }

  async getList() {
    if (this.useRcon) {
      try {
        const r = await this.rcon("list");
        const cm = r.match(/There are\s+(\d+)\s*(?:of a max of\s*(\d+)|\/\s*(\d+))\s*players online/i);
        const pm = r.match(/players online:\s*(.*)$/i);
        return {
          playerCount: cm?.[1] || "0", maxPlayers: cm?.[2] || cm?.[3] || "?",
          players: pm ? pm[1].split(",").map(s => s.trim()).filter(Boolean) : [],
        };
      } catch { return { playerCount: "0", maxPlayers: "?", players: [] }; }
    }
    // Screen fallback
    await this.sendCommand("/list");
    await new Promise(r => setTimeout(r, 200));
    return { playerCount: "?", maxPlayers: "?", players: [] };
  }

  async getSeed() {
    if (this._seedCache) return this._seedCache;
    if (this.useRcon) {
      try {
        const r = await this.rcon("seed");
        const m = r.match(/Seed:\s*\[(-?\d+)\]/);
        if (m) { this._seedCache = m[1]; return this._seedCache; }
      } catch { /* fall through */ }
    }
    await this.sendCommand("/seed");
    await new Promise(r => setTimeout(r, 200));
    const { getLatestLogs } = await import("./utils.js");
    const out = await getLatestLogs(10, this.config.serverDir);
    for (const line of out.split("\n").reverse()) {
      const m = line.match(/Seed:\s*\[(-?\d+)\]/);
      if (m) { this._seedCache = m[1]; return this._seedCache; }
    }
    return null;
  }

  async getPlayerData(player, nbtPath) {
    return await this.sendCommand(`/data get entity ${player} ${nbtPath}`);
  }

  async getPlayerCoords(player) {
    const r = await this.getPlayerData(player, "Pos");
    if (r) {
      const m = r.match(/\[([\d.+-]+)d,\s*([\d.+-]+)d,\s*([\d.+-]+)d\]/);
      if (m) return { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
    }
    await new Promise(r => setTimeout(r, 200));
    const { getLatestLogs } = await import("./utils.js");
    const out = await getLatestLogs(10, this.config.serverDir);
    const m = out.match(/\[([\d.+-]+)d,\s*([\d.+-]+)d,\s*([\d.+-]+)d\]/);
    return m ? { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) } : null;
  }

  async getPlayerDimension(player) {
    const r = await this.getPlayerData(player, "Dimension");
    if (r) { const m = r.match(/"minecraft:([^"]+)"/); if (m) return m[1]; }
    await new Promise(r => setTimeout(r, 200));
    const { getLatestLogs } = await import("./utils.js");
    const out = await getLatestLogs(10, this.config.serverDir);
    const m = out.match(/"minecraft:([^"]+)"/);
    return m ? m[1] : "overworld";
  }

  async getTps() {
    if (!this.useRcon) return null;
    try {
      const r = await this.rcon("tps");
      // Paper/Spigot: "TPS from last 1m, 5m, 15m: 20.0, 20.0, 19.98"
      // Fabric (with mod): "Current TPS: 20.0"
      const m = r.match(/([\d.]+)(?:,\s*([\d.]+)(?:,\s*([\d.]+))?)?/);
      if (m) return { tps1m: parseFloat(m[1]), tps5m: parseFloat(m[2] || m[1]), tps15m: parseFloat(m[3] || m[1]), raw: r };
      return { tps1m: null, raw: r };
    } catch { return null; }
  }
}

// ── ServerManager singleton ──

const instances = new Map();

export function initServers(serversConfig) {
  for (const [id, cfg] of Object.entries(serversConfig)) {
    instances.set(id, new ServerInstance(cfg));
    log.info("server", `Initialized server: ${id} (RCON: ${cfg.useRcon})`);
  }
}

export function getServerInstance(serverId) {
  return instances.get(serverId) || instances.values().next().value || null;
}

export function getAllInstances() {
  return [...instances.values()];
}

// ── Backward-compat re-exports for commands that don't specify a server ──
export function getServerConfig() { return getServerInstance("default")?.config || {}; }
export async function sendToServer(cmd) { return getServerInstance("default")?.sendCommand(cmd); }
export async function isServerRunning() { return getServerInstance("default")?.isRunning() ?? false; }
export async function getServerSeed() { return getServerInstance("default")?.getSeed(); }
export async function getServerList() { return getServerInstance("default")?.getList() ?? { playerCount: "0", maxPlayers: "?", players: [] }; }
export async function getPlayerData(p, n) { return getServerInstance("default")?.getPlayerData(p, n); }
