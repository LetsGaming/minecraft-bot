/**
 * Dashboard auth — hand-rolled Discord OAuth2 (identify scope) plus
 * stateless HMAC-signed session cookies. No auth framework: the flow is
 * three HTTP calls and a cookie, and every dependency in this process
 * is one more thing between an operator and their server console.
 *
 * Admin gate: only USER-ID entries of the global `adminUsers` list and
 * each guild's `adminUsers` may log in. Role entries can't be resolved
 * here (that would need guild member fetches with a bot token) — roles
 * stay a Discord-side permission, which the docs state explicitly.
 *
 * Secrets come from the environment only:
 *   WEBUI_CLIENT_SECRET   Discord application OAuth2 secret
 *   WEBUI_SESSION_SECRET  cookie-signing key (any long random string)
 */
import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import { loadConfig } from "../../common/config.js";
import type { FastifyReply, FastifyRequest } from "fastify";

export const SESSION_COOKIE = "mcbot_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;

export interface Session {
  uid: string;
  tag: string;
  exp: number;
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

// ── Admin gate ────────────────────────────────────────────────────────────

const SNOWFLAKE = /^\d{17,20}$/;

/** Every user-ID admin entry, global and per guild. */
export function webAdminIds(): Set<string> {
  const cfg = loadConfig();
  const ids = new Set<string>();
  for (const entry of cfg.adminUsers ?? []) {
    if (SNOWFLAKE.test(entry)) ids.add(entry);
  }
  for (const gcfg of Object.values(cfg.guilds ?? {})) {
    for (const entry of gcfg.adminUsers ?? []) {
      if (SNOWFLAKE.test(entry)) ids.add(entry);
    }
  }
  return ids;
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
    scope: "identify",
    state,
    prompt: "none",
  });
  return { url: `https://discord.com/oauth2/authorize?${params}`, state };
}

export function verifyState(state: string | undefined): boolean {
  const parsed = decodeSigned<{ exp: number }>(state);
  return !!parsed && parsed.exp > Date.now();
}

/** Exchange the OAuth code for the Discord user (id + tag). */
export async function exchangeCode(
  code: string,
): Promise<{ id: string; tag: string } | null> {
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
  return { id: me.id, tag };
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
  // The admin list is re-checked on every request: removing someone
  // from adminUsers locks them out immediately, not at cookie expiry.
  if (!webAdminIds().has(session.uid)) return null;
  return session;
}

export function setSessionCookie(reply: FastifyReply, user: {
  id: string;
  tag: string;
}): void {
  const session: Session = {
    uid: user.id,
    tag: user.tag,
    exp: Date.now() + SESSION_TTL_MS,
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

/** preHandler: every /api route requires a valid admin session. */
export async function requireAdminSession(
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
