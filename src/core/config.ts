import fs from "fs";
import path from "path";
import { createHash } from "crypto";
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

// Re-exported so callers import validation from @mcbot/core/config.
export { validateCandidateConfig, validateApiUrl };
export type {
  ApiUrlValidation,
  ConfigValidationResult,
} from "./configValidation.js";
export { tryLoadConfig, type ConfigLoadResult } from "./utils/config/configAccess.js";
import { DEFAULT_TPS_ALERT_THRESHOLD } from "@mcbot/schema/thresholds.js";
import { isLanguage } from "@mcbot/schema/language.js";
import { MS } from "@mcbot/schema/time.js";
import { errMsg } from "./utils/error.js";
import {
  SECRET_FILE_MODE,
  writeFileAtomicSync,
} from "./utils/config/atomicWrite.js";
import {
  ConfigMigrationError,
  runConfigMigrations,
  type MigrationResult,
} from "./configMigrations.js";

/** Values a loaded config falls back to when the file leaves a setting out. */
export const CONFIG_DEFAULTS = {
  language: "en",
  tpsWarningThreshold: DEFAULT_TPS_ALERT_THRESHOLD,
  tpsPollIntervalMs: MS.minute,
  leaderboardInterval: "weekly",
} as const satisfies Pick<
  BotConfig,
  "language" | "tpsWarningThreshold" | "tpsPollIntervalMs" | "leaderboardInterval"
>;

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

export interface LoadedConfigRevision {
  /** sha256 of the config.json bytes this process parsed (same digest as configFileHash). */
  hash: string;
  loadedAt: number;
}
let _loadedRevision: LoadedConfigRevision | null = null;

/** The file revision the cached config was parsed from, or null before the first load. */
export function getLoadedConfigRevision(): LoadedConfigRevision | null {
  return _loadedRevision;
}


// Storage audit (2026-09): config.json lives in the shared data/ volume the
// dashboard writes to, so watchConfig() reloads (and re-validates) on every
// save — including edits that touch a field unrelated to a standing warning.
// Without this, a single stale warning (e.g. an http apiUrl) got re-logged in
// full on every dashboard save forever; one deployment had ~2,800 identical
// lines from this alone. Each distinct message is logged once per process —
// a fresh warning still surfaces immediately, a repeat doesn't need saying
// twice, and a restart naturally re-announces whatever is still wrong.
const warnedConfigMessages = new Set<string>();

function validateRawConfig(raw: RawBotConfig, configPath: string): void {
  const { valid, errors, warnings } = validateCandidateConfig(raw);
  for (const warning of warnings) {
    if (warnedConfigMessages.has(warning)) continue;
    warnedConfigMessages.add(warning);
    log.warn("config", warning);
  }
  if (!valid) {
    throw new Error(
      `config.json validation failed at ${configPath}:\n` +
      errors.join("\n") + "\n" +
      "See config.template.json for the expected format and config.schema.json for every option.",
    );
  }
}

/** Absolute path of the active config.json (programmatic editing). */
export function getConfigPath(): string {
  return CONFIG_PATH;
}


// apiUrl and apiKey are present because validateRawConfig ran before this.
function resolveServerConfig(
  raw: RawServerConfig & { id: string },
): ServerConfig {
  return { ...raw, apiUrl: raw.apiUrl!, apiKey: raw.apiKey! };
}

/** ENV_VAR-safe form of a server id: "smp-1" -> "SMP_1". */
function envSuffix(id: string): string {
  return id.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

/** Name of the environment variable that overrides one server's apiKey. */
export function apiKeyEnvVar(id: string): string {
  return `API_KEY_${envSuffix(id)}`;
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
function applyEnvOverrides(raw: RawBotConfig): void {
  if (process.env.DISCORD_TOKEN)     raw.token    = process.env.DISCORD_TOKEN;
  if (process.env.DISCORD_CLIENT_ID) raw.clientId = process.env.DISCORD_CLIENT_ID;
  if (raw.servers && typeof raw.servers === "object") {
    for (const [id, srv] of Object.entries(raw.servers)) {
      // API_KEY_<ID> beats API_KEY, matching the shape RCON_PASSWORD_<ID>
      // had before 5.0.0 — the bot no longer speaks RCON, so the wrapper's
      // key is the only per-server secret it holds.
      const specific = apiKeyEnvVar(id);
      if (process.env[specific]) srv.apiKey = process.env[specific];
      else if (process.env.API_KEY) srv.apiKey = process.env.API_KEY;
    }
  }
}

/**
 * `config.json.bak-v<from>-<UTC timestamp with milliseconds>`, next to the
 * config. A numeric suffix is appended when that exact name is already taken,
 * so two migrations in the same millisecond never collide.
 */
function backupPath(fromVersion: number): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.(\d+)Z$/, "$1Z");
  const base = `${CONFIG_PATH}.bak-v${fromVersion}-${stamp}`;
  if (!fs.existsSync(base)) return base;
  for (let n = 1; ; n++) {
    const candidate = `${base}-${n}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
}

function logMigration(result: MigrationResult): void {
  for (const step of result.applied) {
    const detail = step.changes.length > 0 ? step.changes.join("; ") : "no field changes";
    log.info(
      "config",
      `Migrated config v${step.from} -> v${step.to} (${step.describe}): ${detail}`,
    );
  }
}

/**
 * Bring the parsed file up to the current format. When something changed the
 * original bytes are copied to a backup first, then the migrated file
 * replaces config.json atomically. If either step fails (a read-only mount),
 * the in-memory migrated config is still used and the file is left alone.
 */
function migrateConfigFile(
  raw: RawBotConfig,
  originalText: string,
): { config: RawBotConfig; fileText: string } {
  let result: MigrationResult;
  try {
    result = runConfigMigrations(raw);
  } catch (err) {
    if (err instanceof ConfigMigrationError) {
      throw new Error(`Cannot start with ${CONFIG_PATH}: ${err.message}`);
    }
    throw err;
  }
  if (result.applied.length === 0) return { config: raw, fileText: originalText };

  const backup = backupPath(result.fromVersion);
  const migratedText = JSON.stringify(result.config, null, 2) + "\n";
  let fileText = originalText;
  try {
    fs.writeFileSync(backup, originalText, {
      mode: SECRET_FILE_MODE,
      flag: "wx",
    });
    writeFileAtomicSync(CONFIG_PATH, migratedText);
    fileText = migratedText;
    log.info("config", `Original config saved as ${backup}`);
  } catch (err) {
    log.warn(
      "config",
      `Could not rewrite ${CONFIG_PATH} after migrating it (${errMsg(err)}); running with the migrated config in memory. ` +
        "Make the file writable to persist it.",
    );
  }
  logMigration(result);
  return { config: result.config as unknown as RawBotConfig, fileText };
}

export function loadConfig(): BotConfig {
  if (_config) return _config;

  // An actionable message beats a raw JSON parse stack trace
  let raw: RawBotConfig;
  let rawText: string;
  try {
    // Optimistically typed on parse; validateRawConfig() below is the actual
    // runtime gate — it throws an actionable error if the shape doesn't match,
    // so a wrong config.json never reaches the resolution logic mis-typed.
    rawText = fs.readFileSync(CONFIG_PATH, "utf-8");
    raw = JSON.parse(rawText) as RawBotConfig;
  } catch (err) {
    const reason = errMsg(err);
    throw new Error(
      `Failed to load config.json at ${CONFIG_PATH}: ${reason}\n` +
      "Make sure the file exists and contains valid JSON.",
    );
  }

  const migrated = migrateConfigFile(raw, rawText);
  raw = migrated.config;

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

  _loadedRevision = {
    hash: createHash("sha256").update(migrated.fileText).digest("hex"),
    loadedAt: Date.now(),
  };

  _config = Object.freeze({
    ...raw,
    servers,
    guilds,
    adminUsers: raw.adminUsers ?? [],
    language: isLanguage(raw.language) ? raw.language : CONFIG_DEFAULTS.language,
    commands: raw.commands ?? {},
    tpsWarningThreshold: raw.tpsWarningThreshold ?? CONFIG_DEFAULTS.tpsWarningThreshold,
    tpsPollIntervalMs: raw.tpsPollIntervalMs ?? CONFIG_DEFAULTS.tpsPollIntervalMs,
    leaderboardInterval: raw.leaderboardInterval ?? CONFIG_DEFAULTS.leaderboardInterval,
  });

  return _config;
}

/**
 * Clear the cached config so the next loadConfig() call re-reads from disk.
 * Returns the freshly loaded config.
 */
export function reloadConfig(): BotConfig {
  // AUD-007: keep the old config cached until the new one has loaded, so a
  // malformed save leaves the running process on its last good config.
  const previous = _config;
  _config = null;
  try {
    return loadConfig();
  } catch (err) {
    _config = previous;
    throw err;
  }
}

// ── Config file watcher ───────────────────────────────────────────────────
let _watcher: fs.FSWatcher | null = null;
let _reloadTimer: ReturnType<typeof setTimeout> | null = null;
let _rearmTimer: ReturnType<typeof setTimeout> | null = null;

const WATCH_DEBOUNCE_MS = 300;
const WATCH_REARM_MS = MS.second;

export interface WatchConfigOptions {
  debounceMs?: number;
  rearmMs?: number;
}

/**
 * Watch config.json for changes and automatically invalidate the cache so
 * the next loadConfig() call picks up rotated credentials or updated settings
 * without requiring a process restart.
 *
 * The containing directory is watched, not the file: writeConfig replaces the
 * file by renaming a temp file over it, which on Linux (inotify) leaves a
 * file-level watch attached to the replaced inode so every save after the
 * first would go unseen. A watcher that errors is re-armed after a pause.
 *
 * @param onChange Optional callback invoked after the cache is cleared.
 *                 Useful for re-applying settings (e.g. re-registering commands).
 */
export function watchConfig(
  onChange?: (newConfig: BotConfig) => void,
  options: WatchConfigOptions = {},
): void {
  if (_watcher || _rearmTimer) return; // idempotent: only one watcher per process

  const debounceMs = options.debounceMs ?? WATCH_DEBOUNCE_MS;
  const rearmMs = options.rearmMs ?? WATCH_REARM_MS;
  const dir = path.dirname(CONFIG_PATH);
  const base = path.basename(CONFIG_PATH);

  const scheduleReload = (): void => {
    // A single save raises several events; reload once per burst.
    if (_reloadTimer) clearTimeout(_reloadTimer);
    _reloadTimer = setTimeout(() => {
      _reloadTimer = null;
      try {
        const fresh = reloadConfig();
        onChange?.(fresh);
      } catch (err) {
        // Don't crash the bot on a malformed config save: the old config
        // stays active until a valid file is written.
        log.error("config", `Reload failed after file change: ${errMsg(err)}`);
      }
    }, debounceMs);
  };

  const arm = (afterFailure: boolean): void => {
    _rearmTimer = null;
    try {
      const watcher = fs.watch(dir, (_event, filename) => {
        if (filename && String(filename) !== base) return;
        scheduleReload();
      });
      watcher.on("error", (err) => {
        log.warn("config", `Config watcher failed (${errMsg(err)}); re-arming.`);
        watcher.close();
        if (_watcher === watcher) _watcher = null;
        _rearmTimer = setTimeout(() => arm(true), rearmMs);
        _rearmTimer.unref();
      });
      _watcher = watcher;
      // The file may have changed while no watcher was attached.
      if (afterFailure) scheduleReload();
    } catch (err) {
      log.warn("config", `Cannot watch ${dir} (${errMsg(err)}); retrying.`);
      _rearmTimer = setTimeout(() => arm(true), rearmMs);
      _rearmTimer.unref();
    }
  };
  arm(false);
}

/** Test seam: stop watching and drop any pending reload. */
export function stopWatchingConfig(): void {
  _watcher?.close();
  _watcher = null;
  if (_reloadTimer) clearTimeout(_reloadTimer);
  if (_rearmTimer) clearTimeout(_rearmTimer);
  _reloadTimer = null;
  _rearmTimer = null;
}

/** Get all server IDs */
export function getServerIds(): string[] {
  return Object.keys(loadConfig().servers);
}
