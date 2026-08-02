/**
 * Guided guild-setup reads: the guilds the caller may configure, and each
 * guild's channels and roles, so the setup UI offers dropdowns instead of
 * pasted snowflake IDs. Nothing here mutates config (that goes through the
 * scoped guild-config routes).
 *
 * Registered in the requireSession scope in server.ts. On top of that base
 * login gate, the per-guild routes check canManageGuild, and the guild
 * LIST is filtered to what the caller may manage — so a guild manager only
 * ever sees and reads their own guilds. The Minecraft server list is filtered
 * to the caller's host capabilities, so a guild manager sees none of it.
 *
 * A failed Discord read becomes a typed HTTP failure via discordHttpError
 * (which switches on the DiscordApiError discriminator, QUAL-11) and is
 * rendered by the one error handler — no per-route reply.code().send().
 */
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { readRawConfig } from "@mcbot/core/utils/config/configService.js";
import {
  listBotGuilds,
  listGuildChannels,
  listGuildRoles,
  discordHttpError,
} from "../auth/discordRest.js";
import { sessionFromRequest, isSysadmin, canManageGuild } from "../auth/auth.js";
import { visibleServerIds } from "../auth/capabilities.js";
import { Forbidden } from "../errors.js";
import { IdParams } from "./schemas.js";

/** The 403 a guild-scoped route throws when the caller doesn't manage it. */
function assertManages(session: ReturnType<typeof sessionFromRequest>, guildId: string): void {
  if (!canManageGuild(session!, guildId)) {
    throw new Forbidden("You don't manage that guild.");
  }
}

export function registerSetupRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  // The guilds the caller may configure: sysadmins see every guild the bot
  // is in; everyone else only the guilds they manage. This is what feeds
  // guild names/icons and the setup wizard's picker.
  api.get("/api/setup/guilds", async (req) => {
    const session = sessionFromRequest(req)!;
    try {
      const all = await listBotGuilds();
      const guilds = isSysadmin(session)
        ? all
        : all.filter((g) => session.guilds.includes(g.id));
      return { guilds };
    } catch (err) {
      throw discordHttpError(err);
    }
  });

  // Text/announcement channels for one guild — only if the caller manages it.
  api.get(
    "/api/setup/guilds/:id/channels",
    { schema: { params: IdParams } },
    async (req) => {
      assertManages(sessionFromRequest(req), req.params.id);
      try {
        return { channels: await listGuildChannels(req.params.id) };
      } catch (err) {
        throw discordHttpError(err);
      }
    },
  );

  // Assignable roles for one guild — only if the caller manages it.
  api.get(
    "/api/setup/guilds/:id/roles",
    { schema: { params: IdParams } },
    async (req) => {
      assertManages(sessionFromRequest(req), req.params.id);
      try {
        return { roles: await listGuildRoles(req.params.id) };
      } catch (err) {
        throw discordHttpError(err);
      }
    },
  );

  // The Minecraft server names, for the wizard's "default server" picker.
  //
  // Filtered to what the caller may read, not gated on sysadmin. It was
  // sysadmin-only because that used to be the only way to have any host-side
  // access at all; with capability grants (RBAC-01) that would mean someone
  // who can see a server in /api/status gets a 403 asking for its name here,
  // which is an inconsistency rather than a protection. A caller with no host
  // capabilities still gets an empty list, which is the old behaviour for
  // everyone it was actually protecting against.
  api.get("/api/setup/servers", async (req) => {
    const session = sessionFromRequest(req)!;
    const cfg = readRawConfig();
    const servers = visibleServerIds(session, Object.keys(cfg.servers ?? {}));
    // Still a 403 for a caller with no host access at all, rather than an
    // empty 200. "You have no business here" and "there is nothing here" are
    // different answers, and a guild manager should get the first one.
    if (servers.length === 0 && !isSysadmin(session)) {
      throw new Forbidden("You don't have access to any servers.");
    }
    return { servers };
  });
}
