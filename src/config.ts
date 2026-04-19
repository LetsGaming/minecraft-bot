import fs from "fs";
import path from "path";
import { getRootDir } from "./utils/utils.js";
import type {
  BotConfig,
  GuildConfig,
  RawBotConfig,
  RawServerConfig,
  ServerConfig,
  VariablesMap,
} from "./types/index.js";

const PROJECT_ROOT = getRootDir();
const CONFIG_PATH = path.resolve(PROJECT_ROOT, "config.json");

let _config: BotConfig | null = null;

// B-12: previously this stripped both single and double quotes, while the
// api-server's parseVarsFile only strips double quotes via regex. A value
// like VALUE='something' would parse as "something" here but "'something'"
// there, causing silent config divergence. Aligned to double-quotes only,
// matching the api-server behaviour and the standard shell-var convention.
function parseVariablesTxt(filePath: string): VariablesMap {
  const vars: VariablesMap = {};
  if (!fs.existsSync(filePath)) return vars;
  for (const line of fs.readFileSync(filePath, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^(\w+)="?([^"]*)"?$/);
    if (!m) continue;
    vars[m[1]!] = m[2]!;
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
    apiUrl: raw.apiUrl,
    apiKey: raw.apiKey,
  };
}

export function loadConfig(): BotConfig {
  if (_config) return _config;

  // B-07: give an actionable error message instead of a raw JSON parse stack trace
  let raw: RawBotConfig;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as RawBotConfig;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to load config.json at ${CONFIG_PATH}: ${reason}\n` +
        "Make sure the file exists and contains valid JSON.",
    );
  }

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
