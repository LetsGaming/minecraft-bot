/**
 * Per-guild config for guild managers. These are the ONLY config routes a
 * non-sysadmin can reach: each one is scoped to a single guild and gated
 * by canManageGuild, and none ever returns the full config (which holds
 * server API keys and the bot token) or another guild's block.
 *
 * Registered in the requireSession scope in server.ts; every handler does
 * its own per-guild authorization on top of that base login gate. Bodies are
 * validated at the boundary from the shared schema; failures are typed errors
 * rendered by the one error handler.
 */
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  readRawConfig,
  validateCandidate,
  writeConfig,
  configFileHash,
} from "@mcbot/core/utils/config/configService.js";
import { recordAdminAction } from "@mcbot/core/utils/stores/adminAudit.js";
import { log } from "@mcbot/core/utils/logger.js";
import { sessionFromRequest, isSysadmin, canManageGuild, guildScopeFresh } from "../auth/auth.js";
import { listBotGuilds, discordHttpError } from "../auth/discordRest.js";
import { readConfigSchema } from "../config/configSchema.js";
import { HttpError, Forbidden, Conflict, ValidationFailed, ServiceUnavailable } from "../errors.js";
import type { RawBotConfig } from "@mcbot/core/types/index.js";
import { IdParams, GuildConfigWriteBody, MutationResult } from "./schemas.js";

// Guild-block keys that count as "a feature is on". Mirrors the wizard;
// statusEmbed is on only when explicitly enabled, the rest when present.
const FEATURE_KEYS = [
  "notifications", "chatBridge", "leaderboard", "statusEmbed",
  "downtimeAlerts", "tpsAlerts", "channelPurge", "reports",
  "console", "whitelistApplications", "linkedRole",
];

function enabledFeatures(block: Record<string, unknown> | undefined): string[] {
  if (!block) return [];
  return FEATURE_KEYS.filter((k) => {
    const v = block[k];
    if (v === undefined || v === null) return false;
    if (k === "statusEmbed") return (v as { enabled?: boolean }).enabled === true;
    return true;
  });
}

export function registerGuildConfigRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  /**
   * The guilds the current user may configure, each flagged configured
   * and with its enabled-feature keys — everything GuildsView and the
   * overview need, without exposing the rest of the config. Sysadmins see
   * every guild the bot is in; managers see only the ones they manage.
   */
  api.get("/api/guilds", async (req) => {
    const session = sessionFromRequest(req)!;
    let botGuildIds: string[];
    try {
      botGuildIds = (await listBotGuilds()).map((g) => g.id);
    } catch (err) {
      throw discordHttpError(err);
    }
    const visible = isSysadmin(session)
      ? botGuildIds
      : botGuildIds.filter((id) => session.guilds.includes(id));

    const cfg = readRawConfig();
    // guilds is a map of per-guild config objects; widen to an index type to
    // read each block generically for the response below.
    const guilds = (cfg.guilds ?? {}) as Record<string, Record<string, unknown>>;
    return {
      guilds: visible.map((id) => ({
        id,
        configured: !!guilds[id],
        features: enabledFeatures(guilds[id]),
      })),
    };
  });

  /** One guild's config block (+ the full-config hash for concurrency). */
  // Guild-managers (non-sysadmin) can't reach /api/config/schema, so expose
  // just the GuildConfig definition + all definitions (for $ref resolution)
  // here. Structure only — no secrets. Path resolution mirrors
  // /api/config/schema (same dir depth) so source + deployed trees both work.
  api.get("/api/guilds/config-schema", async () => {
    const full = readConfigSchema();
    const definitions = full?.definitions ?? {};
    const guildSchema = definitions.GuildConfig;
    if (!full || !guildSchema) {
      throw new ServiceUnavailable(
        "Guild config schema unavailable — restart the bot to regenerate it.",
      );
    }
    return { schema: guildSchema, definitions };
  });

  api.get(
    "/api/guilds/:id/config",
    { schema: { params: IdParams } },
    async (req) => {
      const session = sessionFromRequest(req)!;
      if (!canManageGuild(session, req.params.id)) {
        throw new Forbidden("You don't manage that guild.");
      }
      const cfg = readRawConfig();
      const block = (cfg.guilds ?? {})[req.params.id] ?? {};
      return { hash: configFileHash(), guildConfig: block };
    },
  );

  /** Replace one guild's config block, validated and concurrency-checked. */
  api.put(
    "/api/guilds/:id/config",
    { schema: { params: IdParams, body: GuildConfigWriteBody, response: { 200: MutationResult } } },
    async (req) => {
      const session = sessionFromRequest(req)!;
      const guildId = req.params.id;
      if (!canManageGuild(session, guildId)) {
        throw new Forbidden("You don't manage that guild.");
      }
      // A non-sysadmin's captured guild scope must still be fresh to WRITE
      // (SEC-03): if it has aged out, a demoted manager could otherwise keep
      // write access for the whole session, so require a re-login to re-derive
      // current permissions.
      if (!isSysadmin(session) && !guildScopeFresh(session)) {
        throw new Forbidden(
          "Your guild permissions may be out of date — please log in again.",
        );
      }

      const { baseHash, guildConfig } = req.body;

      // Same optimistic-concurrency contract as the full config PUT.
      const currentHash = configFileHash();
      if (baseHash !== currentHash) {
        throw new Conflict(
          "Config changed since you loaded it. Reload and re-apply.",
          { currentHash },
        );
      }

      // Build the new config from the current one on disk, replacing ONLY
      // this guild's block. The manager can't touch other guilds, servers,
      // or top-level settings — those are copied through untouched — then
      // the whole thing is validated as one.
      const current = readRawConfig();
      // Splice the submitted block into the current config and validate the
      // whole thing as one candidate below. `guildConfig` is the request body
      // (object-checked by the schema); the merged object is RawBotConfig-shaped
      // by construction (spread of current + one guild key).
      const merged: RawBotConfig = {
        ...current,
        guilds: {
          ...(current.guilds ?? {}),
          [guildId]: guildConfig as Record<string, unknown>,
        },
      } as RawBotConfig;

      const result = validateCandidate(merged);
      if (!result.valid) {
        throw new ValidationFailed(result.errors);
      }

      let changed = true;
      try {
        ({ changed } = await writeConfig(merged, {
          byTag: session.tag,
          byId: session.uid,
          note: `guild config write (${guildId})`,
        }));
      } catch (err) {
        // Surface the actionable write error (e.g. read-only config path),
        // logged, mirroring the full-config PUT — not a generic 500.
        const msg =
          err instanceof Error ? err.message : "Failed to write guild config.";
        log.error("web", `Guild config write failed: ${msg}`);
        throw new HttpError(500, msg);
      }
      // Only audit an actual change — a Save with no edits is a no-op.
      if (changed) {
        await recordAdminAction({
          action: "guild config write (dashboard)",
          by: session.tag,
          byId: session.uid,
          guildId,
        });
      }
      return { ok: true, changed, warnings: result.warnings };
    },
  );
}
