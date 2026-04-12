import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, "config.json");

let _config = null;

function parseVariablesTxt(filePath) {
  const vars = {};
  if (!fs.existsSync(filePath)) return vars;
  for (const line of fs.readFileSync(filePath, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    vars[m[1]] = v;
  }
  return vars;
}

function resolveServerConfig(raw) {
  // Try to read variables.txt from scripts dir
  const scriptDir = raw.scriptDir || raw.serverDir;
  const varsFile = scriptDir ? path.join(scriptDir, "..", "common", "variables.txt") : null;
  const sv = varsFile ? parseVariablesTxt(varsFile) : {};

  return {
    id: raw.id || "default",
    serverDir: sv.SERVER_PATH || raw.serverDir,
    linuxUser: sv.USER || raw.linuxUser || "minecraft",
    screenSession: sv.INSTANCE_NAME || raw.screenSession || "server",
    useRcon: sv.USE_RCON === "true" || raw.useRcon === true,
    rconHost: sv.RCON_HOST || raw.rconHost || "localhost",
    rconPort: parseInt(sv.RCON_PORT || raw.rconPort || "25575", 10),
    rconPassword: sv.RCON_PASSWORD || raw.rconPassword || "",
    scriptDir: scriptDir || "",
  };
}

export function loadConfig() {
  if (_config) return _config;

  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));

  // ── Resolve servers ──
  const servers = {};
  if (raw.servers && typeof raw.servers === "object") {
    for (const [id, srv] of Object.entries(raw.servers)) {
      servers[id] = resolveServerConfig({ ...srv, id });
    }
  } else {
    // Legacy single-server config — wrap it
    servers.default = resolveServerConfig({ ...raw, id: "default" });
  }

  // ── Guild configs ──
  const guilds = raw.guilds || {};

  _config = Object.freeze({
    token: raw.token,
    clientId: raw.clientId,
    servers,
    guilds,
    commands: raw.commands || {},
    leaderboard: raw.leaderboard || {},
    tpsWarningThreshold: raw.tpsWarningThreshold || 15,
    tpsPollIntervalMs: raw.tpsPollIntervalMs || 60000,
    leaderboardInterval: raw.leaderboardInterval || "weekly",
  });

  return _config;
}

/** Get server config by ID */
export function getServer(serverId) {
  const cfg = loadConfig();
  return cfg.servers[serverId] || null;
}

/** Get the default server for a guild, or the first server */
export function getGuildServer(guildId) {
  const cfg = loadConfig();
  const guild = cfg.guilds[guildId];
  if (guild?.defaultServer && cfg.servers[guild.defaultServer]) {
    return cfg.servers[guild.defaultServer];
  }
  // Fallback to first server
  const keys = Object.keys(cfg.servers);
  return keys.length > 0 ? cfg.servers[keys[0]] : null;
}

/** Get guild notification config */
export function getGuildConfig(guildId) {
  const cfg = loadConfig();
  return cfg.guilds[guildId] || null;
}

/** Get all server IDs */
export function getServerIds() {
  return Object.keys(loadConfig().servers);
}

/** Get all server IDs as Discord choices */
export function getServerChoices() {
  return getServerIds().map(id => ({ name: id, value: id }));
}
