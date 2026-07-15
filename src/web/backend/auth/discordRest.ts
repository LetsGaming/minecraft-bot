/**
 * Minimal Discord REST client for the dashboard's guided guild setup.
 *
 * The web image deliberately excludes discord.js (that library lives in
 * the bot image only), so this uses plain fetch with the bot token —
 * the same approach auth.ts already takes for the OAuth flow. Only the
 * three read endpoints the setup wizard needs are implemented:
 *   - the guilds the bot is in         (GET /users/@me/guilds)
 *   - a guild's text channels          (GET /guilds/:id/channels)
 *   - a guild's assignable roles        (GET /guilds/:id/roles)
 *
 * All calls are bot-token authed and short-timeout guarded. Results are
 * lightly cached (30s) so repeatedly opening the setup panel does not
 * hammer Discord's rate limits.
 */
import { loadConfig } from "@mcbot/core/config.js";
import { log } from "@mcbot/core/utils/logger.js";
import { isRecord } from "@mcbot/core/utils/objects.js";
import {
  type HttpError,
  ServiceUnavailable,
  TooManyRequests,
  Forbidden,
  NotFound,
  BadGateway,
} from "../errors.js";

import { DISCORD_API_V10_BASE } from "@mcbot/schema";

const API = DISCORD_API_V10_BASE;
const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 30_000;

/** Why a Discord read failed — a typed discriminator so callers map failures
 *  to an HTTP status without parsing error strings (QUAL-11). */
export type DiscordErrorReason = "no-token" | "rate-limit" | "http";

/** A failed Discord REST call, carrying the upstream status when there is one. */
export class DiscordApiError extends Error {
  constructor(
    message: string,
    readonly reason: DiscordErrorReason,
    /** Upstream Discord HTTP status when reason === "http"; null otherwise. */
    readonly status: number | null = null,
    /** Retry-after hint (seconds) for reason === "rate-limit". */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "DiscordApiError";
  }
}

/**
 * Map a failed Discord read to the typed HTTP failure a route should throw, so
 * the central error handler renders it (fastify.md / backend-apis.md: "one
 * error handler over typed failures", not a hand-built `reply.code().send()`
 * per call site). Switches on the DiscordApiError discriminator rather than
 * matching message substrings (QUAL-11):
 *   - no token configured        → 503 (operator needs to set it)
 *   - Discord rate-limited us    → 429 (carry the retry hint)
 *   - upstream 403 / 404         → pass through
 *   - any other upstream/network → 502 (bad gateway)
 * The client-facing message keeps the "Couldn't reach Discord" framing the
 * dashboard already showed.
 */
export function discordHttpError(err: unknown): HttpError {
  const detail = err instanceof Error ? err.message : String(err);
  const message = `Couldn't reach Discord: ${detail}`;
  if (err instanceof DiscordApiError) {
    if (err.reason === "no-token") return new ServiceUnavailable(message);
    if (err.reason === "rate-limit")
      return new TooManyRequests(message, err.retryAfterSeconds);
    if (err.status === 403) return new Forbidden(message);
    if (err.status === 404) return new NotFound(message);
  }
  return new BadGateway(message);
}

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  /** Whether the bot account has the Manage Guild permission here. */
  manageable: boolean;
}

export interface DiscordChannel {
  id: string;
  name: string;
  /** Discord channel type; 0 = text, 5 = announcement — the ones we offer. */
  type: number;
  position: number;
  parentId: string | null;
}

export interface DiscordRole {
  id: string;
  name: string;
  color: number;
  position: number;
  /** @everyone and bot-managed roles are not assignable targets. */
  assignable: boolean;
}

// A guild counts as configurable if the bot has Manage Guild (0x20) OR
// Administrator (0x8) — Discord's Administrator implicitly grants every
// permission, so a bot invited with Administrator (common) must not be
// excluded just because the literal Manage Guild bit isn't also set.
const MANAGE_GUILD = 0x20n;
const ADMINISTRATOR = 0x8n;

interface CacheEntry {
  at: number;
  value: unknown;
}
const cache = new Map<string, CacheEntry>();

function botToken(): string {
  const cfg = loadConfig();
  if (!cfg.token) {
    throw new DiscordApiError(
      "Bot token is not configured — cannot query Discord.",
      "no-token",
    );
  }
  return cfg.token;
}

async function discordGet(path: string, cacheKey?: string): Promise<unknown> {
  if (cacheKey) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  }
  const res = await fetch(`${API}${path}`, {
    headers: {
      authorization: `Bot ${botToken()}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 429) {
    // Surface rate limits as a clear, retryable error rather than a
    // parsed-garbage failure. The retry-after is in seconds.
    const retryHeader = res.headers.get("retry-after");
    const retry = retryHeader ?? "a few";
    throw new DiscordApiError(
      `Discord rate limit hit — retry in ${retry}s.`,
      "rate-limit",
      429,
      retryHeader ? Number(retryHeader) : undefined,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    log.warn("web", `Discord GET ${path} failed: ${res.status} ${body.slice(0, 200)}`);
    throw new DiscordApiError(`Discord API error (${res.status}).`, "http", res.status);
  }
  const value: unknown = await res.json();
  if (cacheKey) cache.set(cacheKey, { at: Date.now(), value });
  return value;
}

/**
 * Guilds the bot is a member of. `manageable` reflects whether the BOT
 * account has Manage Guild there — a good proxy for "the bot can be set
 * up here", and independent of which OAuth scopes the admin granted.
 */
export async function listBotGuilds(): Promise<DiscordGuild[]> {
  const raw = await discordGet("/users/@me/guilds", "guilds");
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((g) => {
    if (!isRecord(g)) return [];
    const { id, name, icon, permissions } = g;
    if (typeof id !== "string" || typeof name !== "string") return [];
    let manageable = false;
    try {
      const perms = BigInt(typeof permissions === "string" ? permissions : "0");
      manageable =
        (perms & ADMINISTRATOR) === ADMINISTRATOR ||
        (perms & MANAGE_GUILD) === MANAGE_GUILD;
    } catch {
      /* malformed permissions string → treat as not manageable */
    }
    return [
      { id, name, icon: typeof icon === "string" ? icon : null, manageable },
    ];
  });
}

/** Text + announcement channels of a guild, sorted for display. */
export async function listGuildChannels(guildId: string): Promise<DiscordChannel[]> {
  const raw = await discordGet(`/guilds/${guildId}/channels`, `channels:${guildId}`);
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((c) => {
      if (!isRecord(c)) return [];
      const { id, name, type, position, parent_id } = c;
      if (
        typeof id !== "string" ||
        typeof name !== "string" ||
        typeof type !== "number"
      ) {
        return [];
      }
      // text, announcement
      if (type !== 0 && type !== 5) return [];
      return [
        {
          id,
          name,
          type,
          position: typeof position === "number" ? position : 0,
          parentId: typeof parent_id === "string" ? parent_id : null,
        },
      ];
    })
    .sort((a, b) => a.position - b.position);
}

/**
 * Assignable roles of a guild. @everyone (id === guildId) and
 * bot/integration-managed roles are excluded — they can't be handed to
 * members, so they'd be dead options in a role picker.
 */
export async function listGuildRoles(guildId: string): Promise<DiscordRole[]> {
  const raw = await discordGet(`/guilds/${guildId}/roles`, `roles:${guildId}`);
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((r) => {
      if (!isRecord(r)) return [];
      const { id, name, color, position, managed } = r;
      if (typeof id !== "string" || typeof name !== "string") return [];
      return [
        {
          id,
          name,
          color: typeof color === "number" ? color : 0,
          position: typeof position === "number" ? position : 0,
          assignable: managed !== true && id !== guildId,
        },
      ];
    })
    .sort((a, b) => b.position - a.position);
}
