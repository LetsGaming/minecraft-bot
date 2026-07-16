import fs from "fs";
import path from "path";
import { getRootDir } from "./utils/paths.js";
import { log } from "./utils/logger.js";
import { validateCandidateConfig, validateApiUrl } from "./configValidation.js";
import type {
  BotConfig,
  GuildConfig,
  RawBotConfig,
  RawServerConfig,
  ServerConfig,
} from "./types/index.js";

// Validation moved to its own module (QUAL-02); re-exported here so existing
// callers keep importing it from @mcbot/core/config.
export { validateCandidateConfig, validateApiUrl };
export type {
  ApiUrlValidation,
  ConfigValidationResult,
} from "./configValidation.js";

const PROJECT_ROOT = getRootDir();
// The active config.json. Overridable via MCBOT_CONFIG_PATH so a deployment
// can point it at a writable, process-owned location — in Docker that is the
// shared data/ volume (/app/data/config.json), where the dashboard can rewrite
// it atomically (temp+rename on one filesystem) and where the bot's fs watcher
// picks the edit up. Defaults to <root>/config.json for local/non-container use.
const CONFIG_PATH = process.env.MCBOT_CONFIG_PATH
  ? path.resolve(process.env.MCBOT_CONFIG_PATH)
  : path.resolve(PROJECT_ROOT, "config.json");

let _config: BotConfig | null = null;


function validateRawConfig(raw: RawBotConfig, configPath: string): void {
  const { valid, errors, warnings } = validateCandidateConfig(raw);
  for (const warning of warnings) {
    log.warn("config", warning);
  }
  if (!valid) {
    throw new Error(
      `config.json validation failed at ${configPath}:\n` +
      errors.join("\n") + "\n" +
      "See config_structure.json for the expected format.",
    );
  }
}

/** Absolute path of the active config.json (programmatic editing). */
export function getConfigPath(): string {
  return CONFIG_PATH;
}


function resolveServerConfig(
  raw: RawServerConfig & { id: string },
): ServerConfig {
  // Nothing to derive: since 5.0.0 an instance is a wrapper URL and a key.
  // This used to walk the setup suite's directory layout to find scriptDir,
  // then parse {scriptDir}/common/variables.txt for SERVER_PATH, USER,
  // RCON_* and friends — a second implementation of what the wrapper's own
  // parseVars.ts does, against a file on a machine the bot may not even
  // share. The wrapper reads it now, and reports what it found.
  return {
    id: raw.id,
    apiUrl: raw.apiUrl!,
    apiKey: raw.apiKey!,
    ...(raw.allowInsecureHttp !== undefined
      ? { allowInsecureHttp: raw.allowInsecureHttp }
      : {}),
    ...(raw.commands ? { commands: raw.commands } : {}),
  };
}

/**
 * Apply DISCORD_TOKEN / DISCORD_CLIENT_ID / RCON_PASSWORD[_<SERVER>] over the
 * on-disk config, enabling Docker/K8s secrets injection without touching
 * config files. Empty env vars are treated as unset (the platform passes an
 * empty string for an unset secret).
 *
 * Called BEFORE validation: a deployment may supply a required secret only
 * via the environment (the documented `.env` path), so an env-only token must
 * be in place before the required-field check runs — validating first would
 * reject the very value the override was about to fill in (BUG-01).
 */
/** ENV_VAR-safe form of a server id: "smp-1" -> "SMP_1". */
function envSuffix(id: string): string {
  return id.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function applyEnvOverrides(raw: RawBotConfig): void {
  if (process.env.DISCORD_TOKEN)     raw.token    = process.env.DISCORD_TOKEN;
  if (process.env.DISCORD_CLIENT_ID) raw.clientId = process.env.DISCORD_CLIENT_ID;
  if (raw.servers && typeof raw.servers === "object") {
    for (const [id, srv] of Object.entries(raw.servers)) {
      // API_KEY_<ID> beats API_KEY, matching the shape RCON_PASSWORD_<ID>
      // had before 5.0.0 — the bot no longer speaks RCON, so the wrapper's
      // key is the only per-server secret it holds.
      const specific = `API_KEY_${envSuffix(id)}`;
      if (process.env[specific]) srv.apiKey = process.env[specific];
      else if (process.env.API_KEY) srv.apiKey = process.env.API_KEY;
    }
  }
}

export function loadConfig(): BotConfig {
  if (_config) return _config;

  // An actionable message beats a raw JSON parse stack trace
  let raw: RawBotConfig;
  try {
    // Optimistically typed on parse; validateRawConfig() below is the actual
    // runtime gate — it throws an actionable error if the shape doesn't match,
    // so a wrong config.json never reaches the resolution logic mis-typed.
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as RawBotConfig;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to load config.json at ${CONFIG_PATH}: ${reason}\n` +
      "Make sure the file exists and contains valid JSON.",
    );
  }

  // Env overrides run BEFORE validation so an env-only required secret (the
  // documented Docker/K8s secrets path) satisfies the required-field check
  // instead of being rejected before the override applies (BUG-01).
  applyEnvOverrides(raw);

  // Runtime validation — catches type mismatches that TypeScript cannot
  validateRawConfig(raw, CONFIG_PATH);

  // ── Resolve servers ──
  // The pre-`servers` format, where the top-level object doubled as a single
  // server block, is gone with local mode in 5.0.0: it only ever carried
  // serverDir/linuxUser/rcon* at the root, and validateRawConfig now names
  // those as removed. A config reaching here has a validated servers map.
  const servers: Record<string, ServerConfig> = {};
  for (const [id, srv] of Object.entries(raw.servers ?? {})) {
    servers[id] = resolveServerConfig({ ...srv, id });
  }

  // ── Guild configs ──
  const guilds: Record<string, GuildConfig> = raw.guilds ?? {};

  _config = Object.freeze({
    token:                raw.token,
    clientId:             raw.clientId,
    servers,
    guilds,
    adminUsers:           raw.adminUsers          ?? [],
    // Locale for user-visible strings; anything but "de" → "en"
    language:             raw.language === "de" ? "de" : "en",
    commands:             raw.commands            ?? {},
    leaderboard:          raw.leaderboard         ?? {},
    tpsWarningThreshold:  raw.tpsWarningThreshold ?? 15,
    tpsPollIntervalMs:    raw.tpsPollIntervalMs   ?? 60_000,
    leaderboardInterval:  raw.leaderboardInterval ?? "weekly",
    ...(raw.presence    ? { presence:    raw.presence }    : {}),
    ...(raw.deathCoords ? { deathCoords: raw.deathCoords } : {}),
    ...(raw.hostAlerts  ? { hostAlerts:  raw.hostAlerts }  : {}),
    ...(raw.waypoints   ? { waypoints:   raw.waypoints }   : {}),
    ...(raw.limits      ? { limits:      raw.limits }      : {}),
    ...(raw.updateNotifier ? { updateNotifier: raw.updateNotifier } : {}),
    ...(raw.schedules   ? { schedules:   raw.schedules }   : {}),
    ...(raw.milestones  ? { milestones:  raw.milestones }  : {}),
    ...(raw.webui       ? { webui:       raw.webui }       : {}),
  });

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
          log.error("config", `Reload failed after file change: ${msg}`);
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
