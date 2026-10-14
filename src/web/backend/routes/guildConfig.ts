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
  withConfigWriteLock,
} from "@mcbot/core/utils/config/configService.js";
import { guildConfigHash } from "@mcbot/core/utils/config/guildConfigHash.js";
import { recordAdminAction } from "@mcbot/core/utils/stores/adminAudit.js";
import { log } from "@mcbot/core/utils/logger.js";
import { sessionFromRequest, isSysadmin, canManageGuild, guildScopeFresh } from "../auth/auth.js";
import { listBotGuilds, discordHttpError } from "../auth/discordRest.js";
import { readConfigSchema } from "../config/configSchema.js";
import { HttpError, Forbidden, Conflict, ValidationFailed, ServiceUnavailable } from "../errors.js";
import {
  allowedServerIdsIn,
  referencedServerIds,
} from "@mcbot/core/utils/server/guildTargets.js";
import type { RawBotConfig, GuildConfig } from "@mcbot/core/types/index.js";
import { GUILD_FEATURE_KEYS } from "@mcbot/schema";
import { IdParams, GuildConfigWriteBody, MutationResult } from "./schemas.js";

// A feature counts as on when its key is present; statusEmbed only when
// explicitly enabled.
function enabledFeatures(block: Record<string, unknown> | undefined): string[] {
  if (!block) return [];
  return GUILD_FEATURE_KEYS.filter((k) => {
    const v = block[k];
    if (v === undefined || v === null) return false;
    if (k === "statusEmbed") return (v as { enabled?: boolean }).enabled === true;
    return true;
  });
}

/**
 * Guild-block keys that decide WHO is a bot admin in the guild and WHICH
 * servers it may reach. Those are tenant boundaries the operator draws, not
 * guild settings: a Manage Guild holder who could edit them could grant
 * themselves admin commands against any server (AUD-001).
 */
const SYSADMIN_ONLY_GUILD_KEYS = ["adminUsers", "allowedServers"] as const;

/**
 * Apply what a non-sysadmin may not change in their own guild block. Returns
 * the block to write and the reasons the write is refused (empty when it may
 * proceed).
 *
 * - The sysadmin-only keys keep their value on disk. A block that omits one
 *   keeps it; a block that sends a different value is refused rather than
 *   silently ignored, so the editor shows why the change didn't stick.
 * - Every server the block references must exist, and must already be one
 *   this guild may target under the current config. References widen a
 *   guild's scope when `allowedServers` is unset, so adding one is a scope
 *   change too. An unrestricted guild (single-tenant, or one that references
 *   nothing) may use any configured server: nothing is widened there.
 */
function applyManagerLimits(
  current: RawBotConfig,
  guildId: string,
  submitted: GuildConfig,
): { block: GuildConfig; errors: string[] } {
  const errors: string[] = [];
  const before = (current.guilds ?? {})[guildId];
  const block: GuildConfig = { ...submitted };
  for (const key of SYSADMIN_ONLY_GUILD_KEYS) {
    if (block[key] === undefined) {
      if (before?.[key] !== undefined) block[key] = before[key];
    } else if (JSON.stringify(block[key]) !== JSON.stringify(before?.[key])) {
      errors.push(`guilds.${guildId}.${key} can only be changed by a bot admin.`);
    }
  }

  const known = new Set(Object.keys(current.servers ?? {}));
  const scope = allowedServerIdsIn(current.guilds, guildId);
  for (const id of referencedServerIds(block)) {
    if (!known.has(id)) {
      errors.push(`guilds.${guildId} references unknown server "${id}".`);
    } else if (scope && !scope.has(id)) {
      errors.push(
        `guilds.${guildId} references server "${id}", which this guild may ` +
          `not use. Only a bot admin can give a guild access to another server.`,
      );
    }
  }
  return { block, errors };
}

/**
 * Validation output limited to one guild's block. When the config is
 * invalid only elsewhere, the manager gets a plain explanation instead of
 * someone else's errors.
 */
function scopedToGuild(
  result: { valid: boolean; errors: string[]; warnings: string[] },
  guildId: string,
): { errors: string[]; warnings: string[] } {
  const mine = (line: string): boolean => line.includes(`guilds.${guildId}.`) || line.includes(`guilds.${guildId} `);
  const errors = result.errors.filter(mine);
  return {
    errors:
      errors.length > 0 || result.valid
        ? errors
        : ["The bot's config has a problem outside this guild's settings. Ask a bot administrator to fix it."],
    warnings: result.warnings.filter(mine),
  };
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

  /** One guild's config block (+ a hash of that block for concurrency). */
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
      return { hash: guildConfigHash(block), guildConfig: block };
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

      // The check and the write happen under one lock (AUD-014): saves for
      // two different guilds must not both build from the same file.
      return withConfigWriteLock(async () => {
        // Build the new config from the current one on disk, replacing ONLY
        // this guild's block. The manager can't touch other guilds, servers,
        // or top-level settings; those are copied through untouched. Then
        // the whole thing is validated as one.
        const current = readRawConfig();

        // Optimistic concurrency on this guild's own block: another save only
        // conflicts when it touched the same guild.
        const currentHash = guildConfigHash((current.guilds ?? {})[guildId]);
        if (baseHash !== currentHash) {
          throw new Conflict(
            "This guild's config changed since you loaded it. Reload and re-apply.",
            { currentHash },
          );
        }

        // The request body is object-checked by the schema; its shape is
        // GuildConfig's, which validateCandidate checks below.
        let block = guildConfig as GuildConfig;
        if (!isSysadmin(session)) {
          const limited = applyManagerLimits(current, guildId, block);
          if (limited.errors.length > 0) throw new ValidationFailed(limited.errors);
          block = limited.block;
        }

        // Splice the submitted block into the current config and validate the
        // whole thing as one candidate below. `guildConfig` is the request body
        // (object-checked by the schema); the merged object is RawBotConfig-shaped
        // by construction (spread of current + one guild key).
        const merged: RawBotConfig = {
          ...current,
          guilds: {
            ...(current.guilds ?? {}),
            [guildId]: block,
          },
        } as RawBotConfig;

        const result = validateCandidate(merged);
        // AUD-019: a guild manager sees what concerns their guild only, not
        // other guilds' ids or every server id in the config.
        const shown = isSysadmin(session)
          ? result
          : scopedToGuild(result, guildId);
        if (!result.valid) {
          throw new ValidationFailed(shown.errors);
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
          // The message names the config file's path, which only a sysadmin
          // may see (AUD-019).
          throw new HttpError(
            500,
            isSysadmin(session)
              ? msg
              : "The config could not be saved. A bot administrator can find the reason in the dashboard log.",
          );
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
        return { ok: true, changed, warnings: shown.warnings };
      });
    },
  );
}
