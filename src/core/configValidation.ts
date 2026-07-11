/**
 * Config validation — the pure runtime gate that turns an arbitrary parsed
 * value into a verified config or a list of actionable errors/warnings, plus
 * the apiUrl transport check.
 *
 * Extracted from config.ts (QUAL-02, 2026-07 audit): a ~700-line validator is
 * its own concern, and this file is the seam configValidation.test.ts already
 * assumes. Deliberately free of module state and I/O so it can be called on
 * any candidate — the dashboard validates edits through it before writing, and
 * config.ts calls it at load time (see validateRawConfig).
 */
import { NOTIFICATION_EVENTS, isNotificationEvent } from "@mcbot/schema";
import type { RawBotConfig } from "./types/index.js";

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

  // Shared shape check for a commands override block at any scope
  // (global, guilds.<id>.commands, servers.<id>.commands).
  const validateCommandOverrides = (
    block: unknown,
    label: string,
  ): void => {
    if (block === undefined) return;
    if (typeof block !== "object" || block === null || Array.isArray(block)) {
      errors.push(`  - ${label}: must be an object keyed by command name`);
      return;
    }
    for (const [cmd, override] of Object.entries(
      block as Record<string, unknown>,
    )) {
      if (
        typeof override !== "object" ||
        override === null ||
        Array.isArray(override)
      ) {
        errors.push(`  - ${label}.${cmd}: must be an object`);
        continue;
      }
      const o = override as Record<string, unknown>;
      for (const key of ["enabled", "adminOnly"] as const) {
        if (o[key] !== undefined && typeof o[key] !== "boolean") {
          errors.push(`  - ${label}.${cmd}.${key}: must be a boolean`);
        }
      }
      if (o.options !== undefined) {
        if (
          typeof o.options !== "object" ||
          o.options === null ||
          Array.isArray(o.options)
        ) {
          errors.push(`  - ${label}.${cmd}.options: must be an object`);
        } else {
          for (const [k, v] of Object.entries(
            o.options as Record<string, unknown>,
          )) {
            if (
              typeof v !== "string" &&
              typeof v !== "number" &&
              typeof v !== "boolean"
            ) {
              errors.push(
                `  - ${label}.${cmd}.options.${k}: must be a string, number, or boolean`,
              );
            }
          }
        }
      }
    }
  };
  validateCommandOverrides(raw.commands, "commands");

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
        validateCommandOverrides(srv.commands, `servers.${id}.commands`);
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

        // commands: per-guild slash-command overrides.
        validateCommandOverrides(guild.commands, `guilds.${gid}.commands`);

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

        // notifications: validate the channel + events shape the dispatcher
        // consumes. An ABSENT events list is fine (the dispatcher falls back
        // to the default set), but an explicit EMPTY list with a channel set
        // delivers nothing, and an unknown key silently never matches — warn
        // on both so a dashboard/hand edit doesn't leave the feature inert.
        if (guild.notifications !== undefined) {
          const n = guild.notifications;
          if (typeof n !== "object" || n === null || Array.isArray(n)) {
            errors.push(
              `  - guilds.${gid}.notifications: must be an object ` +
                `({ "channelId": "...", "events": [...] })`,
            );
          } else {
            if (
              n.channelId !== undefined &&
              typeof n.channelId !== "string"
            ) {
              errors.push(
                `  - guilds.${gid}.notifications.channelId: must be a channel ID string`,
              );
            }
            if (n.events !== undefined) {
              if (
                !Array.isArray(n.events) ||
                n.events.some((e) => typeof e !== "string")
              ) {
                errors.push(
                  `  - guilds.${gid}.notifications.events: must be an array of event keys`,
                );
              } else {
                for (const ev of n.events) {
                  if (!isNotificationEvent(ev)) {
                    warnings.push(
                      `guilds.${gid}.notifications.events contains unknown event ` +
                        `"${ev}" (known events: ${NOTIFICATION_EVENTS.join(", ")}) — ` +
                        `it will never match`,
                    );
                  }
                }
                if (n.channelId && n.events.length === 0) {
                  warnings.push(
                    `guilds.${gid}.notifications has a channel but an empty events ` +
                      `list — no messages will be sent (omit "events" to use the ` +
                      `default set)`,
                  );
                }
              }
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
