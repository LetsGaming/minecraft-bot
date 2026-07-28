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
import {
  NOTIFICATION_EVENTS,
  isNotificationEvent,
  REMOVED_LOCAL_SERVER_FIELDS,
} from "@mcbot/schema";
import { checkAgainstSchema } from "./configSchemaCheck.js";
import type { RawBotConfig } from "./types/index.js";
import { isSnowflake, SNOWFLAKE_DESCRIPTION } from "@mcbot/schema/discord.js";

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
 * Present and object-shaped. Only ever false on the schema-unavailable
 * path — when the schema ran, the shape is already guaranteed — so this
 * skips a check rather than reporting one.
 */
const usable = <T>(v: T | undefined): v is T =>
  v !== undefined && v !== null && !Array.isArray(v) && typeof v === "object";

/** Feature `server` fields accept a single ID or a list of them. */
function scopeRefs(
  field: string,
  scope: string | string[] | undefined,
): Array<[string, string]> {
  if (typeof scope === "string") return [[field, scope]];
  if (Array.isArray(scope)) return scope.map((id): [string, string] => [field, id]);
  return [];
}

/** Schema enum failure on a notifications.events entry — downgraded. */
const UNKNOWN_EVENT_ERROR = /\.notifications\.events\.\d+: must be one of/;

const hasScope = (scope: string | string[] | undefined): boolean =>
  typeof scope === "string" || (Array.isArray(scope) && scope.length > 0);

/**
 * Pure validation of a candidate raw config — collects every problem
 * instead of throwing. This is the entry point for programmatic config
 * editing (the dashboard validates a candidate with this before writing
 * it via configService.writeConfig).
 *
 * Two passes, in order:
 *
 *   1. **Structure** — types, requiredness, enums and numeric bounds,
 *      checked against the generated JSON Schema (configSchemaCheck.ts).
 *      This used to be ~700 lines of hand-written `typeof` checks that
 *      described the same shape as the schema and drifted from it.
 *   2. **Meaning** — everything a JSON Schema cannot express: does that
 *      server ID exist, is that string shaped like a Discord snowflake,
 *      is this chat bridge ambiguous, is this a 4.x config. That is what
 *      remains below.
 *
 * The second pass only runs when the first found no errors: a semantic
 * rule about `guilds.x.chatBridge[0].server` means nothing until we know
 * `chatBridge` is an array of objects. Callers get the structural errors
 * first, which are the ones to fix first anyway.
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

  const structural = checkAgainstSchema(candidate);
  // An unrecognised notification event is forward-compatibility, not a
  // broken config: a file written for a newer bot must still boot. The
  // semantic pass below warns about it by name instead.
  const errors: string[] = structural.errors.filter(
    (line) => !UNKNOWN_EVENT_ERROR.test(line),
  );
  const warnings: string[] = [...structural.warnings];

  if (structural.unavailable) {
    warnings.push(
      "config.schema.json could not be read — structural validation was " +
        "skipped and only semantic checks ran. Run `npm run schema:generate`.",
    );
  }
  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  // The schema verified the shape, so the fields below can be read by
  // name. The guards that remain are for the schema-unavailable path.
  const raw = candidate as RawBotConfig;

  // ── servers ───────────────────────────────────────────────────────────
  // Required since 5.0.0, and its absence usually means a 4.x config, so
  // the message points at the migration instead of the field.
  if (raw.servers === undefined) {
    const stale = REMOVED_LOCAL_SERVER_FIELDS.filter(
      (f) => (raw as unknown as Record<string, unknown>)[f] !== undefined,
    );
    errors.push(
      stale.length > 0
        ? `  - servers: required. This looks like the pre-5.0.0 single-server ` +
            `format (${stale.join(", ")} at the top level), which configured ` +
            `local mode. See docs/admin/migrating-to-5.md — 4.3.x ` +
            `is the last release that supported local deployment.`
        : `  - servers: required — an object keyed by server id, each with ` +
            `apiUrl and apiKey (e.g. { "survival": { "apiUrl": "...", "apiKey": "..." } }).`,
    );
  } else if (usable(raw.servers)) {
    for (const [id, srv] of Object.entries(raw.servers)) {
      const stale = REMOVED_LOCAL_SERVER_FIELDS.filter(
        (f) => (srv as Record<string, unknown>)[f] !== undefined,
      );
      if (stale.length > 0) {
        errors.push(
          `  - servers.${id}: ${stale.join(", ")} configured local mode, ` +
            `which was removed in 5.0.0. The bot now reaches every server ` +
            `through an API wrapper. Move those settings into the wrapper's ` +
            `own config on the Minecraft host, delete them here, and set ` +
            `apiUrl + apiKey. See docs/admin/migrating-to-5.md. ` +
            `4.3.x is the last release that supported local deployment.`,
        );
      }

      // Both are optional in the type (env vars can supply the key), so
      // requiredness lives here rather than in the schema.
      if (typeof srv.apiUrl !== "string" || srv.apiUrl.trim() === "") {
        errors.push(
          `  - servers.${id}.apiUrl: required — the base URL of the API ` +
            `wrapper on the Minecraft host (e.g. "http://192.168.1.10:3030").`,
        );
      } else if (typeof srv.apiKey !== "string" || srv.apiKey.trim() === "") {
        errors.push(
          `  - servers.${id}.apiKey: required — the wrapper's shared secret. ` +
            `Set it here, or supply API_KEY_${id
              .toUpperCase()
              .replace(/[^A-Z0-9]/g, "_")} / API_KEY in the environment.`,
        );
      }

      if (typeof srv.apiUrl === "string" && srv.apiUrl.trim() !== "") {
        const check = validateApiUrl(srv.apiUrl, srv.allowInsecureHttp === true);
        if (check.level === "error") {
          errors.push(`  - servers.${id}.apiUrl: ${check.message}`);
        } else if (check.level === "warn") {
          warnings.push(`servers.${id}: ${check.message}`);
        }
      }
    }
  }

  const knownServers = usable(raw.servers)
    ? new Set(Object.keys(raw.servers))
    : null;

  /** A string that should be a Discord ID but isn't → warning, not error. */
  const checkSnowflake = (value: unknown, label: string): void => {
    if (typeof value === "string" && !isSnowflake(value)) {
      warnings.push(
        `${label} "${value}" does not look like a Discord ID ` +
          `(${SNOWFLAKE_DESCRIPTION})`,
      );
    }
  };

  // ── guilds ────────────────────────────────────────────────────────────
  if (usable(raw.guilds)) {
    const guilds = raw.guilds;
    const guildCount = Object.keys(guilds).length;

    for (const [gid, guild] of Object.entries(guilds)) {
      if (
        typeof guild.language === "string" &&
        !["en", "de"].includes(guild.language)
      ) {
        warnings.push(
          `guilds.${gid}.language "${guild.language}" is not a known ` +
            `locale (en, de) — the global language will be used`,
        );
      }

      const bridgeList = Array.isArray(guild.chatBridge)
        ? guild.chatBridge
        : guild.chatBridge
          ? [guild.chatBridge]
          : [];

      // ID-shaped fields: a typo here is a silent no-op at runtime, so
      // surface it in /config instead.
      checkSnowflake(guild.linkedRole, `guilds.${gid}.linkedRole`);
      for (const block of ["downtimeAlerts", "tpsAlerts"] as const) {
        checkSnowflake(
          guild[block]?.mentionRole,
          `guilds.${gid}.${block}.mentionRole`,
        );
      }
      checkSnowflake(
        guild.reports?.mentionRole,
        `guilds.${gid}.reports.mentionRole`,
      );

      // whitelistApplications arms only when BOTH channels are set; a
      // half-filled block looks configured but does nothing.
      const wa = guild.whitelistApplications;
      if (wa) {
        checkSnowflake(
          wa.mentionRole,
          `guilds.${gid}.whitelistApplications.mentionRole`,
        );
        if (!!wa.channelId !== !!wa.adminChannelId) {
          warnings.push(
            `guilds.${gid}.whitelistApplications needs BOTH channelId and ` +
              `adminChannelId — the feature stays off until both are set`,
          );
        }
      }

      // notifications: an absent events list is fine (the dispatcher has a
      // default set), but an explicit empty list with a channel delivers
      // nothing, and an unknown key silently never matches.
      const events = guild.notifications?.events;
      if (Array.isArray(events)) {
        for (const ev of events) {
          if (!isNotificationEvent(ev)) {
            warnings.push(
              `guilds.${gid}.notifications.events contains unknown event ` +
                `"${ev}" (known events: ${NOTIFICATION_EVENTS.join(", ")}) — ` +
                `it will never match`,
            );
          }
        }
        if (guild.notifications?.channelId && events.length === 0) {
          warnings.push(
            `guilds.${gid}.notifications has a channel but an empty events ` +
              `list — no messages will be sent (omit "events" to use the ` +
              `default set)`,
          );
        }
      }

      // Every `server` scope must name a configured server.
      if (knownServers) {
        const refs: Array<[string, string]> = [
          ...scopeRefs("defaultServer", guild.defaultServer),
          ...bridgeList.flatMap((b) => scopeRefs("chatBridge.server", b?.server)),
          ...scopeRefs("notifications.server", guild.notifications?.server),
          ...scopeRefs("leaderboard.server", guild.leaderboard?.server),
          ...scopeRefs("tpsAlerts.server", guild.tpsAlerts?.server),
          ...scopeRefs("downtimeAlerts.server", guild.downtimeAlerts?.server),
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

      // A guild with no scoping at all can target every server — fine
      // alone, a tenant leak once the bot is shared.
      if (guildCount > 1) {
        const derived =
          hasScope(guild.defaultServer) ||
          bridgeList.some((b) => hasScope(b?.server)) ||
          hasScope(guild.notifications?.server) ||
          hasScope(guild.leaderboard?.server) ||
          hasScope(guild.tpsAlerts?.server) ||
          hasScope(guild.downtimeAlerts?.server) ||
          hasScope(guild.reports?.server);
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

  // ── presence ──────────────────────────────────────────────────────────
  if (
    typeof raw.presence?.server === "string" &&
    knownServers &&
    !knownServers.has(raw.presence.server)
  ) {
    warnings.push(
      `presence.server references unknown server "${raw.presence.server}" ` +
        `(configured servers: ${[...knownServers].join(", ")})`,
    );
  }

  // ── waypoints ─────────────────────────────────────────────────────────
  // The schema says "number"; whole-number-ness is the semantic part.
  const maxPerServer = raw.waypoints?.maxPerServer;
  if (
    maxPerServer !== undefined &&
    (!Number.isInteger(maxPerServer) || maxPerServer < 1)
  ) {
    errors.push("  - waypoints.maxPerServer: must be a positive integer");
  }

  // ── schedules ─────────────────────────────────────────────────────────
  if (usable(raw.schedules)) {
    const dayCodes = new Set(["SU", "MO", "TU", "WE", "TH", "FR", "SA"]);
    for (const [sid, entry] of Object.entries(raw.schedules)) {
      if (knownServers && !knownServers.has(sid)) {
        warnings.push(
          `schedules.${sid} references unknown server "${sid}" ` +
            `(configured servers: ${[...knownServers].join(", ")})`,
        );
      }
      const restart = entry?.restart;
      if (!restart) continue;

      if (
        typeof restart.time !== "string" ||
        !/^([01]\d|2[0-3]):([0-5]\d)$/.test(restart.time)
      ) {
        errors.push(`  - schedules.${sid}.restart.time: must be "HH:MM" (24h)`);
      }
      if (
        restart.days !== undefined &&
        (!Array.isArray(restart.days) ||
          restart.days.some(
            (d) => typeof d !== "string" || !dayCodes.has(d.toUpperCase()),
          ))
      ) {
        errors.push(
          `  - schedules.${sid}.restart.days: must be an array of "SU".."SA"`,
        );
      }
      if (
        restart.warnMinutes !== undefined &&
        (!Array.isArray(restart.warnMinutes) ||
          restart.warnMinutes.some(
            (m) => typeof m !== "number" || !Number.isFinite(m) || m <= 0,
          ))
      ) {
        errors.push(
          `  - schedules.${sid}.restart.warnMinutes: must be an array of positive numbers`,
        );
      }
    }
  }

  // ── webui ─────────────────────────────────────────────────────────────
  const port = raw.webui?.port;
  if (
    port !== undefined &&
    (!Number.isInteger(port) || port < 1 || port > 65535)
  ) {
    errors.push("  - webui.port: must be a port number (1–65535)");
  }

  // ── milestones ────────────────────────────────────────────────────────
  // Typed Record<string, unknown> in the schema, so the thresholds are
  // ours to check.
  if (usable(raw.milestones)) {
    for (const [key, arr] of Object.entries(raw.milestones)) {
      if (!Array.isArray(arr) || arr.some((v) => typeof v !== "number" || !(v > 0))) {
        errors.push(`  - milestones.${key}: must be an array of positive numbers`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
