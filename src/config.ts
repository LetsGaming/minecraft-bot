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
const CONFIG_PATH  = path.resolve(PROJECT_ROOT, "config.json");

let _config: BotConfig | null = null;

// ── Runtime schema validation ─────────────────────────────────────────────
// TypeScript's type system only operates at compile time. A malformed
// config.json (wrong types, missing required fields) produces cryptic
// runtime errors deep inside Discord.js or the RCON client. Validating
// here gives an actionable error message at startup instead.

function validateRawConfig(raw: RawBotConfig, configPath: string): void {
  const errors: string[] = [];

  if (!raw.token || typeof raw.token !== "string") {
    errors.push("  - token: required string (your Discord bot token)");
  }
  if (!raw.clientId || typeof raw.clientId !== "string") {
    errors.push("  - clientId: required string (your Discord application ID)");
  }

  // Validate servers block if present
  if (raw.servers !== undefined) {
    if (typeof raw.servers !== "object" || Array.isArray(raw.servers)) {
      errors.push("  - servers: must be an object (e.g. { \"survival\": { ... } })");
    } else {
      for (const [id, srv] of Object.entries(raw.servers)) {
        if (srv.rconPort !== undefined) {
          const p = Number(srv.rconPort);
          if (!Number.isInteger(p) || p < 1 || p > 65535) {
            errors.push(`  - servers.${id}.rconPort: must be an integer between 1 and 65535`);
          }
        }
        if (srv.apiUrl !== undefined && typeof srv.apiUrl !== "string") {
          errors.push(`  - servers.${id}.apiUrl: must be a string URL`);
        }
      }
    }
  }

  if (raw.tpsWarningThreshold !== undefined) {
    if (typeof raw.tpsWarningThreshold !== "number" || raw.tpsWarningThreshold <= 0) {
      errors.push("  - tpsWarningThreshold: must be a positive number (e.g. 15)");
    }
  }
  if (raw.tpsPollIntervalMs !== undefined) {
    if (typeof raw.tpsPollIntervalMs !== "number" || raw.tpsPollIntervalMs < 1000) {
      errors.push("  - tpsPollIntervalMs: must be a number >= 1000 ms");
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `config.json validation failed at ${configPath}:\n` +
      errors.join("\n") + "\n" +
      "See config_structure.json for the expected format.",
    );
  }
}

// ── Variables.txt parser ──────────────────────────────────────────────────
// B-12: aligned to double-quotes only, matching the api-server's parseVarsFile
// and the standard shell-variable convention. A value quoted with single
// quotes (VALUE='something') was previously stripped to "something" here
// but left as "'something'" in the api-server, causing silent divergence.
function parseVariablesTxt(filePath: string): VariablesMap {
  const vars: VariablesMap = {};
  if (!fs.existsSync(filePath)) return vars;
  for (const rawLine of fs.readFileSync(filePath, "utf-8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    // Branch 1: KEY="value"
    const quoted = line.match(/^(\w+)="(.*)"$/);
    if (quoted) { vars[quoted[1]!] = quoted[2]!; continue; }
    // Branch 2: KEY=value (unquoted)
    const unquoted = line.match(/^(\w+)=(.*)$/);
    if (unquoted) vars[unquoted[1]!] = unquoted[2]!.trim();
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
    id:            raw.id,
    serverDir:     sv.SERVER_PATH    ?? raw.serverDir    ?? "",
    linuxUser:     sv.USER           ?? raw.linuxUser    ?? "minecraft",
    screenSession: sv.INSTANCE_NAME  ?? raw.screenSession ?? "server",
    useRcon:       sv.USE_RCON === "true" || raw.useRcon === true,
    rconHost:      sv.RCON_HOST      ?? raw.rconHost     ?? "localhost",
    rconPort:      parseInt(String(sv.RCON_PORT ?? raw.rconPort ?? "25575"), 10),
    rconPassword:  sv.RCON_PASSWORD  ?? raw.rconPassword ?? "",
    scriptDir,
    apiUrl:        raw.apiUrl,
    apiKey:        raw.apiKey,
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

  // Runtime validation — catches type mismatches that TypeScript cannot
  validateRawConfig(raw, CONFIG_PATH);

  // ── Environment variable overrides ──────────────────────────────────────
  // Env vars take precedence over config.json, enabling Docker/K8s secrets
  // injection without touching config files.
  //
  //   DISCORD_TOKEN      — overrides token
  //   DISCORD_CLIENT_ID  — overrides clientId
  //   RCON_PASSWORD      — overrides rconPassword for ALL configured servers
  //   RCON_PASSWORD_<SERVER_ID_UPPER> — overrides for a specific server
  if (process.env.DISCORD_TOKEN)     raw.token    = process.env.DISCORD_TOKEN;
  if (process.env.DISCORD_CLIENT_ID) raw.clientId = process.env.DISCORD_CLIENT_ID;
  if (raw.servers && typeof raw.servers === "object") {
    for (const [id, srv] of Object.entries(raw.servers)) {
      const specific = `RCON_PASSWORD_${id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
      if (process.env[specific]) srv.rconPassword = process.env[specific];
      else if (process.env.RCON_PASSWORD) srv.rconPassword = process.env.RCON_PASSWORD;
    }
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
    token:                raw.token,
    clientId:             raw.clientId,
    servers,
    guilds,
    adminUsers:           raw.adminUsers          ?? [],
    // F-05: locale for user-visible strings; anything but "de" → "en"
    language:             raw.language === "de" ? "de" : "en",
    commands:             raw.commands            ?? {},
    leaderboard:          raw.leaderboard         ?? {},
    tpsWarningThreshold:  raw.tpsWarningThreshold ?? 15,
    tpsPollIntervalMs:    raw.tpsPollIntervalMs   ?? 60_000,
    leaderboardInterval:  raw.leaderboardInterval ?? "weekly",
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

// ── Config file watcher ───────────────────────────────────────────────────
let _watcher: ReturnType<typeof fs.watch> | null = null;

/**
 * Watch config.json for changes and automatically invalidate the cache so
 * the next loadConfig() call picks up rotated credentials or updated settings
 * without requiring a process restart.
 *
 * @param onChange Optional callback invoked after the cache is cleared.
 *                 Useful for re-applying settings (e.g. re-registering commands).
 */
export function watchConfig(onChange?: (newConfig: BotConfig) => void): void {
  if (_watcher) return; // idempotent — only one watcher per process

  try {
    _watcher = fs.watch(CONFIG_PATH, () => {
      // fs.watch can fire multiple events for a single save; debounce via
      // a short timeout so we only reload once per edit.
      if (_reloadTimer) clearTimeout(_reloadTimer);
      _reloadTimer = setTimeout(() => {
        _reloadTimer = null;
        try {
          const fresh = reloadConfig();
          onChange?.(fresh);
        } catch (err) {
          // Don't crash the bot on a malformed config save — the old config
          // stays active until a valid file is written.
          const msg = err instanceof Error ? err.message : String(err);
          // eslint-disable-next-line no-console
          console.error(`[config] Reload failed after file change: ${msg}`);
        }
      }, 300);
    });
    _watcher.on("error", () => { _watcher = null; });
  } catch {
    // fs.watch unavailable in this environment — skip silently
  }
}

let _reloadTimer: ReturnType<typeof setTimeout> | null = null;

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
  const cfg   = loadConfig();
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
