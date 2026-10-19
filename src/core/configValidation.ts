/**
 * Config validation: the pure runtime gate that turns an arbitrary parsed
 * value into a verified config or a list of actionable errors/warnings, plus
 * the apiUrl transport check.
 *
 * Free of module state and I/O so it can be called on any candidate: the
 * dashboard validates edits through it before writing, and config.ts calls it
 * at load time (see validateRawConfig).
 */
import {
  NOTIFICATION_EVENTS,
  isNotificationEvent,
  REMOVED_LOCAL_SERVER_FIELDS,
  LANGUAGES,
  isLanguage,
} from "@mcbot/schema";
import { apiKeyEnvVar } from "./config.js";
import {
  bridgesOf,
  guildServerScopes,
  scopeToList,
} from "./utils/server/guildScopes.js";
import { checkAgainstSchema, type SchemaIssue } from "./configSchemaCheck.js";
import { CURRENT_CONFIG_VERSION } from "./configMigrations.js";
import type {
  GuildConfig,
  RawBotConfig,
} from "./types/index.js";
import { isSnowflake, SNOWFLAKE_DESCRIPTION } from "@mcbot/schema/discord.js";
import { isEmbedColorKey, parseHexColor } from "@mcbot/schema/embedCategories.js";

/**
 * Longest server id that still leaves room in a 100-character component id
 * for the prefix, action and a 20-digit user id around it.
 */
const SERVER_ID_MAX_LENGTH = 32;

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

/**
 * A schema enum failure that is forward-compatibility rather than a broken
 * config: an unrecognised `guilds.<id>.notifications.events[n]` or
 * `guilds.<id>.language` (a file written for a newer bot). The semantic pass
 * warns about these by name.
 */
function isForwardCompatEnum(issue: SchemaIssue): boolean {
  if (issue.keyword !== "enum") return false;
  const [root, , field, sub, index] = issue.path;
  if (root !== "guilds") return false;
  if (issue.path.length === 3) return field === "language";
  return (
    issue.path.length === 5 &&
    field === "notifications" &&
    sub === "events" &&
    /^\d+$/.test(index ?? "")
  );
}

interface Findings {
  errors: string[];
  warnings: string[];
}

/** Everything a section check reads: the config and the configured server IDs. */
interface SectionContext extends Findings {
  raw: RawBotConfig;
  /** Null only on the schema-unavailable path, when `servers` may be malformed. */
  knownServers: Set<string> | null;
}

function checkSnowflake(
  warnings: string[],
  value: unknown,
  label: string,
): void {
  if (typeof value === "string" && !isSnowflake(value)) {
    warnings.push(
      `${label} "${value}" does not look like a Discord ID ` +
        `(${SNOWFLAKE_DESCRIPTION})`,
    );
  }
}

function checkConfigVersion({ raw, errors }: SectionContext): void {
  if (
    typeof raw.configVersion === "number" &&
    raw.configVersion > CURRENT_CONFIG_VERSION
  ) {
    errors.push(
      `  - configVersion: ${raw.configVersion} is newer than this bot supports ` +
        `(${CURRENT_CONFIG_VERSION}); update the bot instead of downgrading the file`,
    );
  }
}

// Required since 5.0.0, and its absence usually means a 4.x config, so the
// message points at the migration instead of the field.
function checkServers({ raw, errors, warnings }: SectionContext): void {
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
    return;
  }
  if (!usable(raw.servers)) return;

  for (const [id, srv] of Object.entries(raw.servers)) {
    if (id.includes(":") || id.length > SERVER_ID_MAX_LENGTH) {
      errors.push(
        `  - servers.${id}: the id must not contain ":" and must be at most ` +
          `${SERVER_ID_MAX_LENGTH} characters, because Discord component ids ` +
          `join it with other values using ":" and are capped at 100 characters.`,
      );
    }

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
          `Set it here, or supply ${apiKeyEnvVar(id)} / API_KEY in the environment.`,
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

function checkGuildLocale(
  gid: string,
  guild: GuildConfig,
  { warnings }: Findings,
): void {
  if (
    typeof guild.language === "string" &&
    !isLanguage(guild.language)
  ) {
    warnings.push(
      `guilds.${gid}.language "${guild.language}" is not a known ` +
        `locale (${LANGUAGES.join(", ")}) — the global language will be used`,
    );
  }
}

// An ID-shaped field with a typo is a silent no-op at runtime, so surface it
// in /config instead.
function checkGuildIds(
  gid: string,
  guild: GuildConfig,
  { warnings }: Findings,
): void {
  checkSnowflake(warnings, guild.linkedRole, `guilds.${gid}.linkedRole`);
  for (const block of ["downtimeAlerts", "tpsAlerts"] as const) {
    checkSnowflake(
      warnings,
      guild[block]?.mentionRole,
      `guilds.${gid}.${block}.mentionRole`,
    );
    const policy = guild[block]?.mentionPolicy;
    if (policy !== undefined && policy !== "always" && policy !== "escalation") {
      warnings.push(
        `guilds.${gid}.${block}.mentionPolicy "${String(policy)}" is not ` +
          `"always" or "escalation"; "escalation" will be used`,
      );
    }
  }
  checkSnowflake(
    warnings,
    guild.reports?.mentionRole,
    `guilds.${gid}.reports.mentionRole`,
  );

  // whitelistApplications arms only when BOTH channels are set; a
  // half-filled block looks configured but does nothing.
  const wa = guild.whitelistApplications;
  if (wa) {
    checkSnowflake(
      warnings,
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
}

// An absent events list is fine (the dispatcher has a default set), but an
// explicit empty list with a channel delivers nothing, and an unknown key
// silently never matches.
function checkGuildNotifications(
  gid: string,
  guild: GuildConfig,
  { warnings }: Findings,
): void {
  const events = guild.notifications?.events;
  if (!Array.isArray(events)) return;
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
function checkGuildServerRefs(
  gid: string,
  guild: GuildConfig,
  { warnings, knownServers }: SectionContext,
): void {
  if (!knownServers) return;
  const scopes = [
    ...guildServerScopes(guild),
    { field: "allowedServers", ids: scopeToList(guild.allowedServers) },
  ];
  for (const { field, ids } of scopes) {
    for (const ref of ids) {
      if (ref && !knownServers.has(ref)) {
        warnings.push(
          `guilds.${gid}.${field} references unknown server "${ref}" ` +
            `(configured servers: ${[...knownServers].join(", ")})`,
        );
      }
    }
  }
}

// Chat bridges must be unambiguous: one channel <-> one server.
function checkChatBridges(
  gid: string,
  guild: GuildConfig,
  { errors, knownServers }: SectionContext,
): void {
  const serverCount = knownServers?.size ?? 1;
  const channelBinding = new Map<string, string>();
  for (const bridge of bridgesOf(guild)) {
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
}

// A guild with no scoping at all can target every server: fine alone, a
// tenant leak once the bot is shared.
function checkTenantIsolation(
  gid: string,
  guild: GuildConfig,
  guildCount: number,
  { warnings }: Findings,
): void {
  if (guildCount <= 1) return;
  const derived = guildServerScopes(guild).some((s) => s.ids.length > 0);
  if (guild.allowedServers?.length === 0 && !guild.defaultServer) {
    warnings.push(
      `guilds.${gid}: allowedServers is empty and no defaultServer is set: ` +
        `this guild can target no server at all.`,
    );
  }
  if (!guild.allowedServers && !derived) {
    warnings.push(
      `guilds.${gid}: no allowedServers/defaultServer set — commands ` +
        `from this guild can target EVERY configured server. In ` +
        `multi-guild setups, set "allowedServers" to isolate tenants.`,
    );
  }
}

function checkGuilds(ctx: SectionContext): void {
  if (!usable(ctx.raw.guilds)) return;
  const guilds = ctx.raw.guilds;
  const guildCount = Object.keys(guilds).length;
  for (const [gid, guild] of Object.entries(guilds)) {
    checkGuildLocale(gid, guild, ctx);
    checkGuildIds(gid, guild, ctx);
    checkGuildNotifications(gid, guild, ctx);
    checkGuildServerRefs(gid, guild, ctx);
    checkChatBridges(gid, guild, ctx);
    checkTenantIsolation(gid, guild, guildCount, ctx);
  }
}

function checkPresence({ raw, warnings, knownServers }: SectionContext): void {
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
}

function checkEmbedColors({ raw, errors, warnings }: SectionContext): void {
  if (!usable(raw.embedColors)) return;
  for (const [key, value] of Object.entries(raw.embedColors)) {
    if (!isEmbedColorKey(key)) {
      warnings.push(`embedColors.${key} is not a known embed category or rarity and is ignored`);
    } else if (parseHexColor(value) === undefined) {
      errors.push(`  - embedColors.${key}: must be a color like #4ade80`);
    }
  }
}

function checkSchedules({ raw, errors, warnings, knownServers }: SectionContext): void {
  if (!usable(raw.schedules)) return;
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
  }
}

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
 *   2. **Meaning** — everything a JSON Schema cannot express: does that
 *      server ID exist, is that string shaped like a Discord snowflake,
 *      is this chat bridge ambiguous, is this a 4.x config. One function
 *      per config section, below.
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
  const errors: string[] = structural.errors
    .filter((issue) => !isForwardCompatEnum(issue))
    .map((issue) => issue.line);
  const warnings: string[] = structural.warnings.map((issue) => issue.line);

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
  const ctx: SectionContext = {
    raw,
    errors,
    warnings,
    knownServers: usable(raw.servers) ? new Set(Object.keys(raw.servers)) : null,
  };

  checkConfigVersion(ctx);
  checkServers(ctx);
  checkGuilds(ctx);
  checkPresence(ctx);
  checkEmbedColors(ctx);
  checkSchedules(ctx);

  return { valid: errors.length === 0, errors, warnings };
}
