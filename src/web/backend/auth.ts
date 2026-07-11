/**
 * Dashboard auth — hand-rolled Discord OAuth2 (identify + guilds scopes)
 * plus stateless HMAC-signed session cookies. No auth framework: the flow
 * is a few HTTP calls and a cookie.
 *
 * Two roles, checked per request (not just at login):
 *   - Sysadmin: a user ID in the TOP-LEVEL `adminUsers` list. Full access:
 *     server status/operations, host metrics, the whole config, audit.
 *   - Guild manager: any Discord user who has Manage Guild (or is owner/
 *     admin) on a guild the bot is in. May configure that guild's bot
 *     features and nothing else — never the Minecraft server, other
 *     guilds, or global settings.
 * Anyone can log in; what they can do is decided per route. The set of
 * guilds a user manages is captured at login (from the `guilds` scope,
 * intersected with the bot's guilds) and carried in the session; sysadmin
 * status is re-derived from config on every request so it stays current.
 *
 * Secrets come from the environment only:
 *   WEBUI_CLIENT_SECRET   Discord application OAuth2 secret
 *   WEBUI_SESSION_SECRET  cookie-signing key (any long random string)
 */
import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import { loadConfig } from "@mcbot/core/config.js";
import type { FastifyReply, FastifyRequest } from "fastify";

export const SESSION_COOKIE = "mcbot_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;
// Guild-manager permissions are captured at login and can't be re-derived
// mid-session (the OAuth token isn't stored). Trust that captured scope for
// writes only this long, so a demoted manager loses config-write access
// within the window instead of for the full session TTL (SEC-03). Sysadmin
// status is re-derived per request from config, so sysadmins are unaffected.
const GUILD_SCOPE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export interface Session {
  uid: string;
  tag: string;
  exp: number;
  /** Guild IDs this user can manage (Discord perms), captured at login. */
  guilds: string[];
  /** When the captured guild scope stops being trusted for writes (SEC-03).
   *  Optional: cookies issued before this field existed lack it. */
  gexp?: number;
}

function sessionSecret(): string {
  const secret = process.env.WEBUI_SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "WEBUI_SESSION_SECRET must be set (>= 16 chars) to run the dashboard",
    );
  }
  return secret;
}

export function clientSecret(): string {
  const secret = process.env.WEBUI_CLIENT_SECRET;
  if (!secret) {
    throw new Error(
      "WEBUI_CLIENT_SECRET must be set to the Discord application's OAuth2 secret",
    );
  }
  return secret;
}

// ── Signed payloads (sessions + OAuth state share the format) ────────────

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export function encodeSigned(data: object): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSigned<T>(token: string | undefined): T | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as T;
  } catch {
    return null;
  }
}

// ── Roles ─────────────────────────────────────────────────────────────────

const SNOWFLAKE = /^\d{17,20}$/;
const ADMINISTRATOR = 0x8n;
const MANAGE_GUILD = 0x20n;

/**
 * Sysadmin user IDs: the TOP-LEVEL `adminUsers` list only. These are the
 * operators who get server operations, host metrics, and global config.
 * Per-guild `adminUsers` are a Discord-command concept, not sysadmins.
 */
export function globalAdminIds(): Set<string> {
  const cfg = loadConfig();
  const ids = new Set<string>();
  for (const entry of cfg.adminUsers ?? []) {
    if (SNOWFLAKE.test(entry)) ids.add(entry);
  }
  return ids;
}

/** Re-derived from config every call, so removing a sysadmin is immediate. */
export function isSysadmin(session: Session): boolean {
  return globalAdminIds().has(session.uid);
}

/**
 * May this session configure guild `guildId`? Sysadmins can manage every
 * guild; everyone else only the guilds they had Manage Guild on at login.
 */
export function canManageGuild(session: Session, guildId: string): boolean {
  return isSysadmin(session) || session.guilds.includes(guildId);
}

/**
 * Is the caller's captured guild scope still fresh enough to authorize a
 * guild-config WRITE (SEC-03)? A missing gexp (cookie predates this check)
 * counts as stale — fail closed, prompting a re-login that re-derives current
 * membership. Reads keep using canManageGuild; only mutations require freshness.
 */
export function guildScopeFresh(session: Session): boolean {
  return typeof session.gexp === "number" && session.gexp > Date.now();
}

/**
 * From Discord's `GET /users/@me/guilds` payload, the IDs of guilds the
 * user can manage: owner, Administrator, or Manage Guild.
 */
export function manageableGuildIds(
  guilds: Array<{ id: string; owner?: boolean; permissions?: string }>,
): string[] {
  const out: string[] = [];
  for (const g of guilds) {
    if (g.owner) {
      out.push(g.id);
      continue;
    }
    try {
      const perms = BigInt(g.permissions ?? "0");
      if ((perms & ADMINISTRATOR) === ADMINISTRATOR || (perms & MANAGE_GUILD) === MANAGE_GUILD) {
        out.push(g.id);
      }
    } catch {
      /* malformed permissions → not manageable */
    }
  }
  return out;
}

// ── OAuth2 endpoints ──────────────────────────────────────────────────────

export function oauthClientId(): string {
  const cfg = loadConfig();
  return cfg.webui?.clientId ?? cfg.clientId;
}

export function publicBaseUrl(): string {
  const cfg = loadConfig();
  const port = cfg.webui?.port ?? 8130;
  return (cfg.webui?.publicUrl ?? `http://localhost:${port}`).replace(
    /\/$/,
    "",
  );
}

export function redirectUri(): string {
  return `${publicBaseUrl()}/auth/callback`;
}

export function buildAuthorizeUrl(): { url: string; state: string } {
  const state = encodeSigned({
    n: randomBytes(8).toString("hex"),
    exp: Date.now() + STATE_TTL_MS,
  });
  const params = new URLSearchParams({
    client_id: oauthClientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "identify guilds",
    state,
    prompt: "none",
  });
  return { url: `https://discord.com/oauth2/authorize?${params}`, state };
}

export function verifyState(state: string | undefined): boolean {
  const parsed = decodeSigned<{ exp: number }>(state);
  return !!parsed && parsed.exp > Date.now();
}

/** Exchange the OAuth code for the Discord user (id + tag + manageable guilds). */
export async function exchangeCode(
  code: string,
): Promise<{ id: string; tag: string; guildIds: string[] } | null> {
  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: oauthClientId(),
      client_secret: clientSecret(),
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenRes.ok) return null;
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) return null;

  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!meRes.ok) return null;
  const me = (await meRes.json()) as {
    id?: string;
    username?: string;
    discriminator?: string;
  };
  if (!me.id) return null;
  const tag =
    me.discriminator && me.discriminator !== "0"
      ? `${me.username}#${me.discriminator}`
      : (me.username ?? me.id);

  // The user's guilds (with their permissions there) — how we know which
  // guilds this person may configure. A failure here is non-fatal: they
  // can still log in, just with no guild-manager access until next login.
  let guildIds: string[] = [];
  try {
    const gRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (gRes.ok) {
      const list = (await gRes.json()) as Array<{
        id: string;
        owner?: boolean;
        permissions?: string;
      }>;
      guildIds = manageableGuildIds(list);
    }
  } catch {
    /* guild fetch failed → no manager access this session */
  }

  return { id: me.id, tag, guildIds };
}

// ── Fastify glue ──────────────────────────────────────────────────────────

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

export function sessionFromRequest(req: FastifyRequest): Session | null {
  const cookies = parseCookies(req.headers.cookie);
  const session = decodeSigned<Session>(cookies[SESSION_COOKIE]);
  if (!session || session.exp <= Date.now()) return null;
  // Any validly-signed, unexpired cookie is a logged-in user. What they
  // may DO is decided per route (isSysadmin / canManageGuild), so there
  // is no global admin gate here anymore.
  if (!Array.isArray(session.guilds)) session.guilds = [];
  return session;
}

export function setSessionCookie(reply: FastifyReply, user: {
  id: string;
  tag: string;
  guildIds: string[];
}): void {
  const session: Session = {
    uid: user.id,
    tag: user.tag,
    guilds: user.guildIds,
    exp: Date.now() + SESSION_TTL_MS,
    gexp: Date.now() + GUILD_SCOPE_TTL_MS,
  };
  const secure = publicBaseUrl().startsWith("https://") ? "; Secure" : "";
  reply.header(
    "set-cookie",
    `${SESSION_COOKIE}=${encodeSigned(session)}; Path=/; HttpOnly; SameSite=Lax` +
      `; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`,
  );
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.header(
    "set-cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

/** preHandler: every /api route requires a valid (any) logged-in session. */
export async function requireSession(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const session = sessionFromRequest(req);
  if (!session) {
    await reply.code(401).send({ error: "unauthorized" });
    return;
  }
  (req as FastifyRequest & { session: Session }).session = session;
}

/** preHandler: sysadmin-only routes (server ops, host metrics, full config). */
export async function requireSysadmin(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const session = sessionFromRequest(req);
  if (!session) {
    await reply.code(401).send({ error: "unauthorized" });
    return;
  }
  if (!isSysadmin(session)) {
    await reply.code(403).send({ error: "forbidden", detail: "Sysadmin access required." });
    return;
  }
  (req as FastifyRequest & { session: Session }).session = session;
}
