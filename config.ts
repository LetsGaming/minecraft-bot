import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type {
  BotConfig,
  GuildConfig,
  RawBotConfig,
  RawServerConfig,
  ServerConfig,
  VariablesMap,
} from "./types/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * config.json lives in the project root, but at runtime __dirname
 * points to dist/ (the compiled output). Walk up to the directory
 * containing package.json so the path is correct in both dev and prod.
 */
function findProjectRoot(): string {
  let dir = __dirname;
  while (true) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return __dirname;
    dir = parent;
  }
}

const PROJECT_ROOT = findProjectRoot();
const CONFIG_PATH = path.resolve(PROJECT_ROOT, "config.json");

let _config: BotConfig | null = null;

function parseVariablesTxt(filePath: string): VariablesMap {
  const vars: VariablesMap = {};
  if (!fs.existsSync(filePath)) return vars;
  for (const line of fs.readFileSync(filePath, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (!m) continue;
    let v = m[2]!.trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    vars[m[1]!] = v;
  }
  return vars;
}

function resolveServerConfig(
  raw: RawServerConfig & { id: string },
): ServerConfig {
  // Derive scriptDir from serverDir if not explicitly set
  // Typical layout: /home/minecraft/minecraft-server/server       (serverDir)
  //                 /home/minecraft/minecraft-server/scripts/server (scriptDir)
  let scriptDir = raw.scriptDir ?? "";
  if (!scriptDir && raw.serverDir) {
    const instanceName = raw.screenSession ?? raw.id ?? "server";
    const candidate = path.resolve(
      raw.serverDir,
      "..",
      "scripts",
      instanceName,
    );
    if (fs.existsSync(candidate)) scriptDir = candidate;
  }

  // variables.txt lives at {scriptDir}/common/variables.txt
  const varsFile = scriptDir
    ? path.join(scriptDir, "common", "variables.txt")
    : null;
  const sv =
    varsFile && fs.existsSync(varsFile) ? parseVariablesTxt(varsFile) : {};

  return {
    id: raw.id,
    serverDir: sv.SERVER_PATH ?? raw.serverDir ?? "",
    linuxUser: sv.USER ?? raw.linuxUser ?? "minecraft",
    screenSession: sv.INSTANCE_NAME ?? raw.screenSession ?? "server",
    useRcon: sv.USE_RCON === "true" || raw.useRcon === true,
    rconHost: sv.RCON_HOST ?? raw.rconHost ?? "localhost",
    rconPort: parseInt(String(sv.RCON_PORT ?? raw.rconPort ?? "25575"), 10),
    rconPassword: sv.RCON_PASSWORD ?? raw.rconPassword ?? "",
    scriptDir: scriptDir,
  };
}

export function loadConfig(): BotConfig {
  if (_config) return _config;

  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as RawBotConfig;

  // ── Resolve servers ──
  const servers: Record<string, ServerConfig> = {};
  if (raw.servers && typeof raw.servers === "object") {
    for (const [id, srv] of Object.entries(raw.servers)) {
      servers[id] = resolveServerConfig({ ...srv, id });
    }
  } else {
    // Legacy single-server config — wrap it
    servers.default = resolveServerConfig({
      ...(raw as unknown as RawServerConfig),
      id: "default",
    });
  }

  // ── Guild configs ──
  const guilds: Record<string, GuildConfig> = raw.guilds ?? {};

  _config = Object.freeze({
    token: raw.token,
    clientId: raw.clientId,
    servers,
    guilds,
    adminUsers: raw.adminUsers ?? [],
    commands: raw.commands ?? {},
    leaderboard: raw.leaderboard ?? {},
    tpsWarningThreshold: raw.tpsWarningThreshold ?? 15,
    tpsPollIntervalMs: raw.tpsPollIntervalMs ?? 60000,
    leaderboardInterval: raw.leaderboardInterval ?? "weekly",
  }) as BotConfig;

  return _config;
}

/**
 * Clear the cached config so the next loadConfig() call re-reads from disk.
 * Returns the freshly loaded config.
 */
export function reloadConfig(): BotConfig {
  _config = null;
  return loadConfig();
}

/** Get server config by ID */
export function getServer(serverId: string): ServerConfig | null {
  const cfg = loadConfig();
  return cfg.servers[serverId] ?? null;
}

/**
 * Returns the default server ID for a guild, or the first configured server ID.
 * Commands should pass this to getServerInstance() to get the actual instance.
 */
export function getGuildServerId(guildId: string | undefined): string | null {
  if (!guildId) return null;
  const cfg = loadConfig();
  const guild = cfg.guilds[guildId];
  if (guild?.defaultServer && cfg.servers[guild.defaultServer]) {
    return guild.defaultServer;
  }
  const keys = Object.keys(cfg.servers);
  return keys.length > 0 ? keys[0]! : null;
}

/** Get guild notification config */
export function getGuildConfig(guildId: string): GuildConfig | null {
  const cfg = loadConfig();
  return cfg.guilds[guildId] ?? null;
}

/** Get all server IDs */
export function getServerIds(): string[] {
  return Object.keys(loadConfig().servers);
}

/** Get all server IDs as Discord choices */
export function getServerChoices(): Array<{ name: string; value: string }> {
  return getServerIds().map((id) => ({ name: id, value: id }));
}
