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
        if (guild.language !== undefined) {
          if (typeof guild.language !== "string") {
            errors.push(
              `  - guilds.${gid}.language: must be a string ("en" | "de")`,
            );
          } else if (!["en", "de"].includes(guild.language)) {
            warnings.push(
              `guilds.${gid}.language "${guild.language}" is not a known ` +
                `locale (en, de) — the global language will be used`,
            );
          }
        }

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

        // chatBridge.useWebhook: plain boolean per bridge entry.
        for (const bridge of bridgeList) {
          const useWebhook = (bridge as { useWebhook?: unknown })?.useWebhook;
          if (useWebhook !== undefined && typeof useWebhook !== "boolean") {
            errors.push(
              `  - guilds.${gid}.chatBridge (channel ${bridge?.channelId ?? "?"}): useWebhook must be a boolean`,
            );
          }
        }

        // linkedRole: auto-role on account link. Validating the shape here
        // means a typo surfaces in /config (and later in the dashboard's
        // phase-2 forms) instead of as a silent no-op at link time.
        if (guild.linkedRole !== undefined) {
          if (typeof guild.linkedRole !== "string") {
            errors.push(
              `  - guilds.${gid}.linkedRole: must be a role ID string`,
            );
          } else if (!/^\d{17,20}$/.test(guild.linkedRole)) {
            warnings.push(
              `guilds.${gid}.linkedRole "${guild.linkedRole}" does not look ` +
                `like a Discord role ID (17–20 digits)`,
            );
          }
        }

        // Alert blocks: mentionRole must be a role-ID-shaped string.
        for (const blockName of ["downtimeAlerts", "tpsAlerts"] as const) {
          const block = guild[blockName];
          if (block && typeof block === "object" && !Array.isArray(block)) {
            const role = (block as { mentionRole?: unknown }).mentionRole;
            if (role !== undefined) {
              if (typeof role !== "string") {
                errors.push(
                  `  - guilds.${gid}.${blockName}.mentionRole: must be a role ID string`,
                );
              } else if (!/^\d{17,20}$/.test(role)) {
                warnings.push(
                  `guilds.${gid}.${blockName}.mentionRole "${role}" does not ` +
                    `look like a Discord role ID (17–20 digits)`,
                );
              }
            }
          }
        }

        // leaderboard.categories: names must exist so a typo surfaces in
        // /config instead of as a silently skipped embed.
        if (guild.leaderboard?.categories !== undefined) {
          const cats = guild.leaderboard.categories;
          if (
            !Array.isArray(cats) ||
            cats.some((c) => typeof c !== "string")
          ) {
            errors.push(
              `  - guilds.${gid}.leaderboard.categories: must be an array of stat keys`,
            );
          }
        }

        // whitelistApplications: both channel IDs must be strings; a
        // half-configured block (only one channel) is warned so the
        // feature never half-arms silently.
        if (guild.whitelistApplications !== undefined) {
          const wa = guild.whitelistApplications;
          if (typeof wa !== "object" || wa === null || Array.isArray(wa)) {
            errors.push(
              `  - guilds.${gid}.whitelistApplications: must be an object`,
            );
          } else {
            for (const key of ["channelId", "adminChannelId"] as const) {
              if (wa[key] !== undefined && typeof wa[key] !== "string") {
                errors.push(
                  `  - guilds.${gid}.whitelistApplications.${key}: must be a channel ID string`,
                );
              }
            }
            if (!!wa.channelId !== !!wa.adminChannelId) {
              warnings.push(
                `guilds.${gid}.whitelistApplications needs BOTH channelId and ` +
                  `adminChannelId — the feature stays off until both are set`,
              );
            }
            if (
              wa.mentionRole !== undefined &&
              typeof wa.mentionRole !== "string"
            ) {
              errors.push(
                `  - guilds.${gid}.whitelistApplications.mentionRole: must be a role ID string`,
              );
            }
          }
        }

        // console: live-tail relay target.
        if (guild.console !== undefined) {
          if (
            typeof guild.console !== "object" ||
            guild.console === null ||
            Array.isArray(guild.console)
          ) {
            errors.push(
              `  - guilds.${gid}.console: must be an object ({ "channelId": "..." })`,
            );
          } else if (
            guild.console.channelId !== undefined &&
            typeof guild.console.channelId !== "string"
          ) {
            errors.push(
              `  - guilds.${gid}.console.channelId: must be a channel ID string`,
            );
          }
        }

        // reports: in-game !report routing.
        if (guild.reports !== undefined) {
          if (
            typeof guild.reports !== "object" ||
            guild.reports === null ||
            Array.isArray(guild.reports)
          ) {
            errors.push(
              `  - guilds.${gid}.reports: must be an object ` +
                `({ "channelId": "...", "mentionRole": "..." })`,
            );
          } else {
            if (
              guild.reports.channelId !== undefined &&
              typeof guild.reports.channelId !== "string"
            ) {
              errors.push(
                `  - guilds.${gid}.reports.channelId: must be a channel ID string`,
              );
            }
            if (
              guild.reports.mentionRole !== undefined &&
              typeof guild.reports.mentionRole !== "string"
            ) {
              errors.push(
                `  - guilds.${gid}.reports.mentionRole: must be a role ID string`,
              );
            }
          }
        }

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
            ...scopeRefs("reports.server", guild.reports?.server),
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
            anyScope(guild.downtimeAlerts?.server) ||
            anyScope(guild.reports?.server);
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

  if (raw.presence !== undefined) {
    if (
      typeof raw.presence !== "object" ||
      raw.presence === null ||
      Array.isArray(raw.presence)
    ) {
      errors.push('  - presence: must be an object ({ "enabled": true })');
    } else {
      if (
        raw.presence.enabled !== undefined &&
        typeof raw.presence.enabled !== "boolean"
      ) {
        errors.push("  - presence.enabled: must be a boolean");
      }
      if (
        raw.presence.format !== undefined &&
        typeof raw.presence.format !== "string"
      ) {
        errors.push("  - presence.format: must be a string template");
      }
      if (
        raw.presence.downFormat !== undefined &&
        typeof raw.presence.downFormat !== "string"
      ) {
        errors.push("  - presence.downFormat: must be a string template");
      }
      if (raw.presence.server !== undefined) {
        if (typeof raw.presence.server !== "string") {
          errors.push("  - presence.server: must be a server ID string");
        } else if (
          raw.servers &&
          typeof raw.servers === "object" &&
          !Array.isArray(raw.servers) &&
          !(raw.presence.server in raw.servers)
        ) {
          warnings.push(
            `presence.server references unknown server "${raw.presence.server}" ` +
              `(configured servers: ${Object.keys(raw.servers).join(", ")})`,
          );
        }
      }
    }
  }

  if (raw.deathCoords !== undefined) {
    if (
      typeof raw.deathCoords !== "object" ||
      raw.deathCoords === null ||
      Array.isArray(raw.deathCoords)
    ) {
      errors.push('  - deathCoords: must be an object ({ "dmLinked": true })');
    } else if (
      raw.deathCoords.dmLinked !== undefined &&
      typeof raw.deathCoords.dmLinked !== "boolean"
    ) {
      errors.push("  - deathCoords.dmLinked: must be a boolean");
    }
  }

  if (raw.hostAlerts !== undefined) {
    if (
      typeof raw.hostAlerts !== "object" ||
      raw.hostAlerts === null ||
      Array.isArray(raw.hostAlerts)
    ) {
      errors.push(
        '  - hostAlerts: must be an object ({ "diskWarnPercent": 90 })',
      );
    } else {
      if (raw.hostAlerts.diskWarnPercent !== undefined) {
        const p = raw.hostAlerts.diskWarnPercent;
        if (typeof p !== "number" || p < 0 || p > 100) {
          errors.push(
            "  - hostAlerts.diskWarnPercent: must be a number between 0 and 100",
          );
        }
      }
      if (raw.hostAlerts.backupMaxAgeHours !== undefined) {
        const h = raw.hostAlerts.backupMaxAgeHours;
        if (typeof h !== "number" || h < 0) {
          errors.push(
            "  - hostAlerts.backupMaxAgeHours: must be a number >= 0 (0 disables)",
          );
        }
      }
    }
  }

  if (raw.waypoints !== undefined) {
    if (
      typeof raw.waypoints !== "object" ||
      raw.waypoints === null ||
      Array.isArray(raw.waypoints)
    ) {
      errors.push('  - waypoints: must be an object ({ "maxPerServer": 100 })');
    } else if (raw.waypoints.maxPerServer !== undefined) {
      const max = raw.waypoints.maxPerServer;
      if (typeof max !== "number" || !Number.isInteger(max) || max < 1) {
        errors.push("  - waypoints.maxPerServer: must be a positive integer");
      }
    }
  }

  if (raw.limits !== undefined) {
    if (
      typeof raw.limits !== "object" ||
      raw.limits === null ||
      Array.isArray(raw.limits)
    ) {
      errors.push('  - limits: must be an object ({ "slashCapacity": 5 })');
    } else {
      const l = raw.limits as Record<string, unknown>;
      for (const key of ["slashCapacity", "bridgeCapacity"]) {
        const v = l[key];
        if (v !== undefined && (typeof v !== "number" || v < 1)) {
          errors.push(`  - limits.${key}: must be a number >= 1`);
        }
      }
      for (const key of ["slashWindowMs", "bridgeWindowMs"]) {
        const v = l[key];
        if (v !== undefined && (typeof v !== "number" || v < 1000)) {
          errors.push(`  - limits.${key}: must be a number >= 1000 ms`);
        }
      }
    }
  }

  if (raw.schedules !== undefined) {
    if (
      typeof raw.schedules !== "object" ||
      raw.schedules === null ||
      Array.isArray(raw.schedules)
    ) {
      errors.push("  - schedules: must be an object keyed by server ID");
    } else {
      const known =
        raw.servers && typeof raw.servers === "object"
          ? new Set(Object.keys(raw.servers))
          : null;
      const dayCodes = new Set(["SU", "MO", "TU", "WE", "TH", "FR", "SA"]);
      for (const [sid, entry] of Object.entries(raw.schedules)) {
        if (known && !known.has(sid)) {
          warnings.push(
            `schedules.${sid} references unknown server "${sid}" ` +
              `(configured servers: ${[...known].join(", ")})`,
          );
        }
        const restart = (entry as { restart?: unknown })?.restart;
        if (restart === undefined) continue;
        if (
          typeof restart !== "object" ||
          restart === null ||
          Array.isArray(restart)
        ) {
          errors.push(
            `  - schedules.${sid}.restart: must be an object ({ "time": "04:00" })`,
          );
          continue;
        }
        const r = restart as Record<string, unknown>;
        if (
          typeof r.time !== "string" ||
          !/^([01]\d|2[0-3]):([0-5]\d)$/.test(r.time)
        ) {
          errors.push(
            `  - schedules.${sid}.restart.time: must be "HH:MM" (24h)`,
          );
        }
        if (r.days !== undefined) {
          if (
            !Array.isArray(r.days) ||
            r.days.some(
              (d) =>
                typeof d !== "string" || !dayCodes.has(d.toUpperCase()),
            )
          ) {
            errors.push(
              `  - schedules.${sid}.restart.days: must be an array of "SU".."SA"`,
            );
          }
        }
        if (r.warnMinutes !== undefined) {
          if (
            !Array.isArray(r.warnMinutes) ||
            r.warnMinutes.some(
              (m) => typeof m !== "number" || !Number.isFinite(m) || m <= 0,
            )
          ) {
            errors.push(
              `  - schedules.${sid}.restart.warnMinutes: must be an array of positive numbers`,
            );
          }
        }
      }
    }
  }

  if (raw.webui !== undefined) {
    if (
      typeof raw.webui !== "object" ||
      raw.webui === null ||
      Array.isArray(raw.webui)
    ) {
      errors.push('  - webui: must be an object ({ "enabled": true })');
    } else {
      const w = raw.webui as Record<string, unknown>;
      if (w.enabled !== undefined && typeof w.enabled !== "boolean") {
        errors.push("  - webui.enabled: must be a boolean");
      }
      if (
        w.port !== undefined &&
        (typeof w.port !== "number" ||
          !Number.isInteger(w.port) ||
          w.port < 1 ||
          w.port > 65535)
      ) {
        errors.push("  - webui.port: must be a port number (1–65535)");
      }
      for (const key of ["host", "clientId", "publicUrl"]) {
        if (w[key] !== undefined && typeof w[key] !== "string") {
          errors.push(`  - webui.${key}: must be a string`);
        }
      }
    }
  }

  if (raw.milestones !== undefined) {
    if (
      typeof raw.milestones !== "object" ||
      raw.milestones === null ||
      Array.isArray(raw.milestones)
    ) {
      errors.push(
        '  - milestones: must be an object of statKey → threshold array',
      );
    } else {
      for (const [key, arr] of Object.entries(raw.milestones)) {
        if (
          !Array.isArray(arr) ||
          arr.some((v) => typeof v !== "number" || !(v > 0))
        ) {
          errors.push(
            `  - milestones.${key}: must be an array of positive numbers`,
          );
        }
      }
    }
  }

  if (raw.updateNotifier !== undefined) {
    if (
      typeof raw.updateNotifier !== "object" ||
      raw.updateNotifier === null ||
      Array.isArray(raw.updateNotifier)
    ) {
      errors.push(
        '  - updateNotifier: must be an object ({ "enabled": false })',
      );
    } else {
      for (const key of ["enabled", "dmAdmins"] as const) {
        const v = (raw.updateNotifier as Record<string, unknown>)[key];
        if (v !== undefined && typeof v !== "boolean") {
          errors.push(`  - updateNotifier.${key}: must be a boolean`);
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
    ...(raw.presence    ? { presence:    raw.presence }    : {}),
    ...(raw.deathCoords ? { deathCoords: raw.deathCoords } : {}),
    ...(raw.hostAlerts  ? { hostAlerts:  raw.hostAlerts }  : {}),
    ...(raw.waypoints   ? { waypoints:   raw.waypoints }   : {}),
    ...(raw.limits      ? { limits:      raw.limits }      : {}),
    ...(raw.updateNotifier ? { updateNotifier: raw.updateNotifier } : {}),
    ...(raw.schedules   ? { schedules:   raw.schedules }   : {}),
    ...(raw.milestones  ? { milestones:  raw.milestones }  : {}),
    ...(raw.webui       ? { webui:       raw.webui }       : {}),
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
