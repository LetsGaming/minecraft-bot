/**
 * Discord OAuth2 login flow + the session probe — the only routes that
 * live OUTSIDE the requireAdminSession gate (they are how you get a
 * session in the first place). The crypto and cookie mechanics stay in
 * ../auth.ts; this module is just the route wiring. Split out of
 * server.ts in the QUAL-01 refactor (2026-07 audit).
 */
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@mcbot/core/config.js";
import {
  buildAuthorizeUrl,
  verifyState,
  exchangeCode,
  isSysadmin,
  sessionFromRequest,
  setSessionCookie,
  clearSessionCookie,
} from "../auth.js";
import { listBotGuilds } from "../discordRest.js";

// Permissions the bot needs when joining a new guild. This is the
// integer Discord bakes into the invite URL and pre-checks on the
// authorize screen. Kept deliberately modest — the features the bot
// actually uses: read/send messages + embeds, manage messages (purge),
// manage webhooks (chat bridge), manage roles (linked role), read
// message history, add reactions, view channels. Admins can still tick
// more on Discord's screen if they want.
//   VIEW_CHANNEL 1024 · SEND_MESSAGES 2048 · MANAGE_MESSAGES 8192 ·
//   EMBED_LINKS 16384 · READ_MESSAGE_HISTORY 65536 · ADD_REACTIONS 64 ·
//   MANAGE_ROLES 268435456 · MANAGE_WEBHOOKS 536870912
const INVITE_PERMISSIONS = (
  1024n + 2048n + 8192n + 16384n + 65536n + 64n + 268435456n + 536870912n
).toString();

export function registerAuthRoutes(app: FastifyInstance): void {
  app.get("/auth/login", async (_req, reply) => {
    const { url } = buildAuthorizeUrl();
    return reply.redirect(url);
  });

  app.get("/auth/callback", async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !verifyState(state)) {
      return reply.code(400).send("Invalid OAuth state — try logging in again.");
    }
    const user = await exchangeCode(code);
    if (!user) return reply.code(502).send("Discord OAuth exchange failed.");

    // Any Discord user may log in (like a normal bot dashboard). Their
    // guild-manager access is the intersection of the guilds they manage
    // with the guilds the bot is actually in — so the session only ever
    // grants control over guilds that both parties share. Sysadmin status
    // is derived from config per request, not stored here.
    let guildIds = user.guildIds;
    try {
      const botGuilds = new Set((await listBotGuilds()).map((g) => g.id));
      guildIds = user.guildIds.filter((id) => botGuilds.has(id));
    } catch {
      /* can't confirm bot guilds → keep the user's manageable set as-is */
    }

    setSessionCookie(reply, { id: user.id, tag: user.tag, guildIds });
    return reply.redirect("/");
  });

  app.post("/auth/logout", async (_req, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/api/me", async (req, reply) => {
    const session = sessionFromRequest(req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    // The frontend uses `sysadmin` to decide which tabs to show, and
    // `guildCount` to tell a guild manager whether they have anything to
    // configure at all.
    return {
      uid: session.uid,
      tag: session.tag,
      sysadmin: isSysadmin(session),
      guildCount: session.guilds.length,
    };
  });

  // "Add to Server": the Discord OAuth2 authorize URL that invites the
  // bot into a new guild. Built server-side so the client ID and the
  // permission set live in one place (config + INVITE_PERMISSIONS) and
  // are never hardcoded in the frontend. Session-gated like the rest of
  // /api — you must be a dashboard admin to see it.
  app.get("/api/invite", async (req, reply) => {
    const session = sessionFromRequest(req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const cfg = loadConfig();
    const clientId = cfg.webui?.clientId ?? cfg.clientId;
    const params = new URLSearchParams({
      client_id: clientId,
      scope: "bot applications.commands",
      permissions: INVITE_PERMISSIONS,
    });
    return { url: `https://discord.com/oauth2/authorize?${params.toString()}` };
  });
}
