/**
 * Guided guild-setup routes (phase 4).
 *
 * These back the dashboard's "set up a new guild" flow: they let the
 * browser read, straight from Discord, the guilds the bot is in and each
 * guild's channels and roles — so the setup UI offers dropdowns instead
 * of asking the admin to paste raw snowflake IDs. Writing the resulting
 * config still goes through the existing PUT /api/config path (optimistic
 * concurrency, server-side validation); nothing here mutates anything.
 *
 * Registered inside server.ts's authenticated scope, so every route here
 * sits behind requireAdminSession like the rest of /api.
 *
 * Discord calls can fail (network, rate limit, a missing/invalid token,
 * or the bot not actually being in the guild). Each handler translates
 * those into a clean JSON error with a sensible status rather than a
 * 500 with a stack — the UI shows the message.
 */
import type { FastifyInstance } from "fastify";
import {
  listBotGuilds,
  listGuildChannels,
  listGuildRoles,
} from "../discordRest.js";

function statusFor(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("rate limit")) return 429;
  if (msg.includes("token is not configured")) return 503;
  if (msg.includes("(403)")) return 403;
  if (msg.includes("(404)")) return 404;
  return 502; // upstream Discord error
}

export function registerSetupRoutes(app: FastifyInstance): void {
  // Guilds the bot is a member of, each flagged with whether the bot has
  // Manage Guild there. The UI surfaces manageable guilds as ready to
  // configure and can still show the rest as "invite/permission needed".
  app.get("/api/setup/guilds", async (_req, reply) => {
    try {
      const guilds = await listBotGuilds();
      return { guilds };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return reply.code(statusFor(err)).send({ error: "discord_error", detail });
    }
  });

  // Text/announcement channels for one guild, for the channel pickers.
  app.get<{ Params: { id: string } }>(
    "/api/setup/guilds/:id/channels",
    async (req, reply) => {
      try {
        const channels = await listGuildChannels(req.params.id);
        return { channels };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return reply.code(statusFor(err)).send({ error: "discord_error", detail });
      }
    },
  );

  // Assignable roles for one guild, for the role pickers (e.g. the linked
  // role). @everyone and managed roles are already filtered out upstream.
  app.get<{ Params: { id: string } }>(
    "/api/setup/guilds/:id/roles",
    async (req, reply) => {
      try {
        const roles = await listGuildRoles(req.params.id);
        return { roles };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return reply.code(statusFor(err)).send({ error: "discord_error", detail });
      }
    },
  );
}
