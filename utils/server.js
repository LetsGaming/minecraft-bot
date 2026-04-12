/**
 * Server communication layer — RCON with screen fallback.
 * Reads config from variables.txt (from minecraft-server-setup) when available.
 */
import net from "net";
import fs from "fs";
import path from "path";
import { execCommand } from "../shell/execCommand.js";

// ── Config loading ──

let _config = null;

function loadConfig() {
  if (_config) return _config;

  // Load bot config
  const configPath = path.resolve(process.cwd(), "config.json");
  const botConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  // Try to load variables.txt from the scripts directory
  const scriptDir = botConfig.scriptDir || botConfig.serverDir;
  const varsFile = path.join(scriptDir, "..", "common", "variables.txt");
  const serverVars = {};

  if (fs.existsSync(varsFile)) {
    for (const line of fs.readFileSync(varsFile, "utf-8").split(/\r?\n/)) {
      const match = line.match(/^(\w+)=(.*)$/);
      if (!match) continue;
      let val = match[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      serverVars[match[1]] = val;
    }
  }

  _config = {
    useRcon: serverVars.USE_RCON === "true" || botConfig.useRcon === true,
    rconHost: serverVars.RCON_HOST || botConfig.rconHost || "localhost",
    rconPort: parseInt(serverVars.RCON_PORT || botConfig.rconPort || "25575", 10),
    rconPassword: serverVars.RCON_PASSWORD || botConfig.rconPassword || "",
    linuxUser: serverVars.USER || botConfig.linuxUser,
    screenSession: serverVars.INSTANCE_NAME || botConfig.screenSession,
    serverDir: serverVars.SERVER_PATH || botConfig.serverDir,
  };

  return _config;
}

export function getServerConfig() {
  return loadConfig();
}

// ── RCON protocol ──

const PACKET = { AUTH: 3, AUTH_RESPONSE: 2, COMMAND: 2 };

function encodePacket(id, type, body) {
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

function decodePacket(buf) {
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

// Persistent RCON connection
let _client = null;
let _authenticated = false;
let _connecting = false;
let _cmdId = 10;
let _pending = new Map();
let _dataBuf = Buffer.alloc(0);
let _authResolve = null;
let _authReject = null;

function _cleanup() {
  _authenticated = false;
  _connecting = false;
  if (_client) { _client.removeAllListeners(); _client.destroy(); _client = null; }
  for (const [, cb] of _pending) { clearTimeout(cb.timer); cb.reject(new Error("RCON connection lost")); }
  _pending.clear();
  _dataBuf = Buffer.alloc(0);
  if (_authReject) { _authReject(new Error("RCON connection lost")); _authResolve = null; _authReject = null; }
}

function _connect() {
  const cfg = loadConfig();
  return new Promise((resolve, reject) => {
    if (_authenticated && _client && !_client.destroyed) return resolve();
    if (_connecting) {
      const w = setInterval(() => {
        if (_authenticated) { clearInterval(w); resolve(); }
        if (!_connecting) { clearInterval(w); reject(new Error("RCON failed")); }
      }, 50);
      return;
    }

    _cleanup();
    _connecting = true;
    _authResolve = resolve;
    _authReject = reject;

    _client = new net.Socket();
    _client.setKeepAlive(true, 30000);

    const authTimer = setTimeout(() => { _cleanup(); reject(new Error("RCON auth timeout")); }, 10000);

    _client.connect(cfg.rconPort, cfg.rconHost, () => {
      _client.write(encodePacket(1, PACKET.AUTH, cfg.rconPassword));
    });

    _client.on("data", (data) => {
      _dataBuf = Buffer.concat([_dataBuf, data]);
      while (true) {
        const pkt = decodePacket(_dataBuf);
        if (!pkt) break;
        _dataBuf = _dataBuf.slice(pkt.totalSize);
        if (!_authenticated) {
          clearTimeout(authTimer);
          if (pkt.id === -1) { _connecting = false; _cleanup(); reject(new Error("RCON auth failed")); return; }
          if (pkt.id === 1) { _authenticated = true; _connecting = false; if (_authResolve) { _authResolve(); _authResolve = null; _authReject = null; } }
          continue;
        }
        const cb = _pending.get(pkt.id);
        if (cb) { clearTimeout(cb.timer); _pending.delete(pkt.id); cb.resolve(pkt.body); }
      }
    });

    _client.on("error", () => _cleanup());
    _client.on("close", () => _cleanup());
  });
}

/**
 * Send a command via RCON. Returns the server's response string.
 */
export async function rconCommand(command, timeoutMs = 5000) {
  await _connect();
  const id = _cmdId++;
  if (_cmdId > 2000000000) _cmdId = 10;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { _pending.delete(id); reject(new Error("RCON timeout")); }, timeoutMs);
    _pending.set(id, { resolve, reject, timer });
    _client.write(encodePacket(id, PACKET.COMMAND, command));
  });
}

// ── Screen fallback ──

async function screenCommand(command) {
  const cfg = loadConfig();
  const formatted = command.startsWith("/") ? command : `/${command}`;
  const cmd = `sudo -u ${cfg.linuxUser} screen -S ${cfg.screenSession} -X stuff "${formatted}$(printf '\\r')"`;
  await execCommand(cmd);
}

// ── Unified interface ──

/**
 * Send a command to the Minecraft server.
 * Uses RCON if configured, otherwise falls back to screen.
 * Returns the server response (RCON) or null (screen).
 */
export async function sendToServer(command) {
  const cfg = loadConfig();
  if (cfg.useRcon && cfg.rconPassword) {
    try {
      const cmd = command.startsWith("/") ? command.slice(1) : command;
      return await rconCommand(cmd);
    } catch (err) {
      console.warn(`RCON failed, falling back to screen: ${err.message}`);
      await screenCommand(command);
      return null;
    }
  }
  await screenCommand(command);
  return null;
}

/**
 * Check if the server is reachable.
 */
export async function isServerRunning() {
  const cfg = loadConfig();
  if (cfg.useRcon && cfg.rconPassword) {
    try {
      await rconCommand("list");
      return true;
    } catch {
      return false;
    }
  }
  // Screen fallback
  const output = await execCommand(`sudo -u ${cfg.linuxUser} screen -list`);
  return output ? new RegExp(`\\b\\d+\\.${cfg.screenSession}\\b`).test(output) : false;
}

/**
 * Get player list via RCON or screen /list.
 * Returns { playerCount, maxPlayers, players[] }
 */
export async function getServerList() {
  const cfg = loadConfig();
  if (cfg.useRcon && cfg.rconPassword) {
    try {
      const response = await rconCommand("list");
      // Parse "There are X of a max of Y players online: player1, player2"
      const countMatch = response.match(/There are\s+(\d+)\s*(?:of a max of\s*(\d+)|\/\s*(\d+))\s*players online/i);
      const playersMatch = response.match(/players online:\s*(.*)$/i);
      return {
        playerCount: countMatch ? countMatch[1] : "0",
        maxPlayers: countMatch ? (countMatch[2] || countMatch[3] || "?") : "?",
        players: playersMatch ? playersMatch[1].split(",").map(s => s.trim()).filter(Boolean) : [],
      };
    } catch {
      return { playerCount: "0", maxPlayers: "?", players: [] };
    }
  }
  // Screen fallback — import dynamically to avoid circular deps
  const { getPlayerCount, getOnlinePlayers } = await import("./playerUtils.js");
  const counts = await getPlayerCount();
  const players = await getOnlinePlayers();
  return { ...counts, players };
}

/**
 * Get the world seed. Caches after first successful retrieval.
 */
let _seedCache = null;
export async function getServerSeed() {
  if (_seedCache) return _seedCache;

  const cfg = loadConfig();
  if (cfg.useRcon && cfg.rconPassword) {
    try {
      const response = await rconCommand("seed");
      const match = response.match(/Seed:\s*\[(-?\d+)\]/);
      if (match) { _seedCache = match[1]; return _seedCache; }
    } catch { /* fall through */ }
  }

  // Screen fallback
  await sendToServer("/seed");
  await new Promise(r => setTimeout(r, 150));
  const { getLatestLogs } = await import("./utils.js");
  const output = await getLatestLogs(10);
  for (const line of output.split("\n").reverse()) {
    const match = line.match(/Seed:\s*\[(-?\d+)\]/);
    if (match) { _seedCache = match[1]; return _seedCache; }
  }
  return null;
}

/**
 * Get player data via RCON or screen+log parsing.
 * Returns the raw response string (RCON) or null (screen, data goes to log).
 */
export async function getPlayerData(playerName, nbtPath) {
  const command = `data get entity ${playerName} ${nbtPath}`;
  return await sendToServer(`/${command}`);
}
