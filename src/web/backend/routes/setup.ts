/**
 * Guided guild-setup reads: the guilds the caller may configure, and each
 * guild's channels and roles, so the setup UI offers dropdowns instead of
 * pasted snowflake IDs. Nothing here mutates config (that goes through the
 * scoped guild-config routes).
 *
 * Registered in the requireSession scope in server.ts. On top of that base
 * login gate, the per-guild routes check canManageGuild, and the guild
 * LIST is filtered to what the caller may manage — so a guild manager only
 * ever sees and reads their own guilds. The server list is sysadmin-only.
 *
 * Discord calls can fail (network, rate limit, missing/invalid token, bot
 * not in the guild). Each handler maps those to a clean JSON error.
 */
import type { FastifyInstance } from "fastify";
import { readRawConfig } from "@mcbot/core/utils/configService.js";
import {
  listBotGuilds,
  listGuildChannels,
  listGuildRoles,
  DiscordApiError,
} from "../discordRest.js";
import { sessionFromRequest, isSysadmin, canManageGuild } from "../auth.js";

// Map a failed Discord read to the HTTP status we return. Switches on the
// typed DiscordApiError discriminator rather than matching error-message
// substrings, which silently broke whenever the wording changed (QUAL-11).
function statusFor(err: unknown): number {
  if (err instanceof DiscordApiError) {
    if (err.reason === "no-token") return 503;
    if (err.reason === "rate-limit") return 429;
    if (err.status === 403 || err.status === 404) return err.status;
    return 502; // other upstream Discord error
  }
  return 502; // network / unknown
}

export function registerSetupRoutes(app: FastifyInstance): void {
  // The guilds the caller may configure: sysadmins see every guild the bot
  // is in; everyone else only the guilds they manage. This is what feeds
  // guild names/icons and the setup wizard's picker.
  app.get("/api/setup/guilds", async (req, reply) => {
    const session = sessionFromRequest(req)!;
    try {
      const all = await listBotGuilds();
      const guilds = isSysadmin(session)
        ? all
        : all.filter((g) => session.guilds.includes(g.id));
      return { guilds };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return reply.code(statusFor(err)).send({ error: `Couldn't reach Discord: ${detail}` });
    }
  });

  // Text/announcement channels for one guild — only if the caller manages it.
  app.get<{ Params: { id: string } }>(
    "/api/setup/guilds/:id/channels",
    async (req, reply) => {
      const session = sessionFromRequest(req)!;
      if (!canManageGuild(session, req.params.id)) {
        return reply.code(403).send({ error: "You don't manage that guild." });
      }
      try {
        const channels = await listGuildChannels(req.params.id);
        return { channels };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return reply.code(statusFor(err)).send({ error: `Couldn't reach Discord: ${detail}` });
      }
    },
  );

  // Assignable roles for one guild — only if the caller manages it.
  app.get<{ Params: { id: string } }>(
    "/api/setup/guilds/:id/roles",
    async (req, reply) => {
      const session = sessionFromRequest(req)!;
      if (!canManageGuild(session, req.params.id)) {
        return reply.code(403).send({ error: "You don't manage that guild." });
      }
      try {
        const roles = await listGuildRoles(req.params.id);
        return { roles };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return reply.code(statusFor(err)).send({ error: `Couldn't reach Discord: ${detail}` });
      }
    },
  );

  // The Minecraft server names, for the wizard's "default server" picker.
  // Sysadmin-only: a guild manager should get no information about the
  // Minecraft servers, so managers simply don't see this picker.
  app.get("/api/setup/servers", async (req, reply) => {
    const session = sessionFromRequest(req)!;
    if (!isSysadmin(session)) {
      return reply.code(403).send({ error: "Sysadmin access required — this needs a bot super-admin." });
    }
    const cfg = readRawConfig();
    return { servers: Object.keys(cfg.servers ?? {}) };
  });
}
