import fs from "fs";
import path from "path";
import { getRootDir } from "./utils/utils.js";
import { log } from "./utils/logger.js";
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

/**
 * Is this hostname plainly on a trusted local segment? Covers loopback,
 * RFC1918 / link-local IPv4, IPv6 loopback/ULA/link-local, unqualified
 * single-label hostnames, and the reserved local-use DNS suffixes.
 */
function isLoopbackOrPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (host === "localhost" || host.endsWith(".localhost")) return true;

  // IPv6 literals are the only hosts that may contain ":".
  if (host.includes(":")) {
    if (host === "::1") return true;
    if (host.startsWith("fc") || host.startsWith("fd")) return true; // fc00::/7 ULA
    if (host.startsWith("fe80:")) return true; // link-local
    return false;
  }

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 169 && b === 254) return true; // link-local
    return false;
  }

  if (!host.includes(".")) return true; // unqualified LAN hostname
  return /\.(local|lan|internal|home\.arpa)$/.test(host);
}

export type ApiUrlValidation =
  | { level: "ok" }
  | { level: "warn"; message: string }
  | { level: "error"; message: string };

/**
 * Validate a server's apiUrl transport. The API wrapper has full
 * server-control authority behind a static x-api-key header — over plain
 * HTTP on an untrusted network, key and commands are readable on-path.
 *
 *   https://…                → fine
 *   http:// to LAN/loopback  → allowed with a warning (trusted segment)
 *   http:// to anything else → rejected, unless the server sets
 *                              `allowInsecureHttp: true` (loud warning)
 */
export function validateApiUrl(
  rawUrl: string,
  allowInsecureHttp = false,
): ApiUrlValidation {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { level: "error", message: `not a valid URL: "${rawUrl}"` };
  }

  if (url.protocol === "https:") return { level: "ok" };

  if (url.protocol !== "http:") {
    return {
      level: "error",
      message: `unsupported protocol "${url.protocol}" — use https:// (or http:// on a trusted LAN)`,
    };
  }

  if (isLoopbackOrPrivateHost(url.hostname)) {
    return {
      level: "warn",
      message:
        `apiUrl "${rawUrl}" uses plaintext HTTP. This is acceptable ONLY on a ` +
        `trusted LAN segment — the x-api-key and all server-control commands ` +
        `travel unencrypted. Use https:// if the wrapper is reachable beyond ` +
        `your local network.`,
    };
  }

  if (allowInsecureHttp) {
    return {
      level: "warn",
      message:
        `apiUrl "${rawUrl}" sends the x-api-key and server-control commands ` +
        `over PLAINTEXT HTTP to a non-private host (allowInsecureHttp is set). ` +
        `Anyone on the network path can steal the key and control the server. ` +
        `Strongly consider terminating TLS in front of the API wrapper.`,
    };
  }

  return {
    level: "error",
    message:
      `plaintext http:// to a non-private host ("${url.hostname}") would expose ` +
      `the x-api-key and full server-control traffic to the network. Use ` +
      `https:// (e.g. a reverse proxy in front of the API wrapper), point at a ` +
      `loopback/LAN address, or — if this host really is on a trusted segment ` +
      `we cannot detect — set "allowInsecureHttp": true on this server.`,
  };
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Pure validation of a candidate raw config — collects every problem
 * instead of throwing. This is the entry point for programmatic config
 * editing (a future WebUI validates a candidate with this before writing
 * it via configService.writeConfig).
 */
export function validateCandidateConfig(
  candidate: unknown,
): ConfigValidationResult {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return {
      valid: false,
      errors: ["  - config root: must be a JSON object"],
      warnings: [],
    };
  }
  const raw = candidate as RawBotConfig;
  const errors: string[] = [];
  const warnings: string[] = [];

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
        } else if (srv.apiUrl) {
          // Transport security for the remote API wrapper
          const check = validateApiUrl(
            srv.apiUrl,
            srv.allowInsecureHttp === true,
          );
          if (check.level === "error") {
            errors.push(`  - servers.${id}.apiUrl: ${check.message}`);
          } else if (check.level === "warn") {
            warnings.push(`servers.${id}: ${check.message}`);
          }
        }
      }
    }
  }

  // (warnings are surfaced by the caller — validateRawConfig logs them,
  // programmatic callers receive them in the result)

  // Validate guilds block if present (admin scoping + server references)
  if (raw.guilds !== undefined) {
    if (typeof raw.guilds !== "object" || Array.isArray(raw.guilds)) {
      errors.push('  - guilds: must be an object keyed by guild ID');
    } else {
      const knownServers =
        raw.servers && typeof raw.servers === "object"
          ? new Set(Object.keys(raw.servers))
          : null;
      const guildCount = Object.keys(raw.guilds).length;

      for (const [gid, guild] of Object.entries(raw.guilds)) {
        for (const field of ["adminUsers", "allowedServers"] as const) {
          const value = guild[field];
          if (
            value !== undefined &&
            (!Array.isArray(value) ||
              value.some((v) => typeof v !== "string"))
          ) {
            errors.push(
              `  - guilds.${gid}.${field}: must be an array of strings`,
            );
          }
        }

        const bridgeList = Array.isArray(guild.chatBridge)
          ? guild.chatBridge
          : guild.chatBridge
            ? [guild.chatBridge]
            : [];

        if (knownServers) {
          // Feature `server` fields accept a string or a list of IDs.
          const scopeRefs = (
            field: string,
            scope: string | string[] | undefined,
          ): Array<[string, string]> =>
            typeof scope === "string"
              ? [[field, scope]]
              : Array.isArray(scope)
                ? scope.map((id): [string, string] => [field, id])
                : [];

          const refs: Array<[string, string]> = [
            ...scopeRefs("defaultServer", guild.defaultServer),
            ...bridgeList.flatMap((b) =>
              scopeRefs("chatBridge.server", b?.server),
            ),
            ...scopeRefs("notifications.server", guild.notifications?.server),
            ...scopeRefs("leaderboard.server", guild.leaderboard?.server),
            ...scopeRefs("tpsAlerts.server", guild.tpsAlerts?.server),
            ...scopeRefs(
              "downtimeAlerts.server",
              guild.downtimeAlerts?.server,
            ),
            ...scopeRefs("allowedServers", guild.allowedServers),
          ];
          for (const [field, ref] of refs) {
            if (ref && !knownServers.has(ref)) {
              warnings.push(
                `guilds.${gid}.${field} references unknown server "${ref}" ` +
                  `(configured servers: ${[...knownServers].join(", ")})`,
              );
            }
          }
        }

        // Chat bridges must be unambiguous: one channel ↔ one server.
        const serverCount = knownServers?.size ?? 1;
        const channelBinding = new Map<string, string>();
        for (const bridge of bridgeList) {
          if (!bridge?.channelId) continue;
          const bound =
            bridge.server ??
            guild.defaultServer ??
            (serverCount === 1 ? [...(knownServers ?? [])][0] : undefined);
          if (!bound) {
            errors.push(
              `  - guilds.${gid}.chatBridge (channel ${bridge.channelId}): ` +
                `multiple servers are configured — set "server" on the ` +
                `bridge (or a guild "defaultServer") so the channel is ` +
                `bound to exactly one server.`,
            );
            continue;
          }
          const existing = channelBinding.get(bridge.channelId);
          if (existing && existing !== bound) {
            errors.push(
              `  - guilds.${gid}.chatBridge: channel ${bridge.channelId} is ` +
                `bound to both "${existing}" and "${bound}" — one channel ` +
                `bridges exactly one server; use a separate channel per ` +
                `server.`,
            );
          } else {
            channelBinding.set(bridge.channelId, bound);
          }
        }

        // Multi-guild deployments without any server scoping run
        // unrestricted for that guild — every admin there can target every
        // server. Nudge the operator toward explicit isolation.
        if (guildCount > 1) {
          const anyScope = (
            scope: string | string[] | undefined,
          ): boolean =>
            typeof scope === "string" ||
            (Array.isArray(scope) && scope.length > 0);
          const derived =
            anyScope(guild.defaultServer) ||
            bridgeList.some((b) => anyScope(b?.server)) ||
            anyScope(guild.notifications?.server) ||
            anyScope(guild.leaderboard?.server) ||
            anyScope(guild.tpsAlerts?.server) ||
            anyScope(guild.downtimeAlerts?.server);
          if (!guild.allowedServers && !derived) {
            warnings.push(
              `guilds.${gid}: no allowedServers/defaultServer set — commands ` +
                `from this guild can target EVERY configured server. In ` +
                `multi-guild setups, set "allowedServers" to isolate tenants.`,
            );
          }
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

  return { valid: errors.length === 0, errors, warnings };
}

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

// ── Variables.txt parser ──────────────────────────────────────────────────
// Double-quoted values only, matching the api-server's parseVarsFile and
// the usual shell convention — single quotes are passed through verbatim.
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

  // An actionable message beats a raw JSON parse stack trace
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
    // Locale for user-visible strings; anything but "de" → "en"
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
