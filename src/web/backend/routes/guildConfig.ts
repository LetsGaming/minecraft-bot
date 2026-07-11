/**
 * Per-guild config for guild managers. These are the ONLY config routes a
 * non-sysadmin can reach: each one is scoped to a single guild and gated
 * by canManageGuild, and none ever returns the full config (which holds
 * server API keys and the bot token) or another guild's block.
 *
 * Registered in the requireSession scope in server.ts; every handler does
 * its own per-guild authorization on top of that base login gate.
 */
import type { FastifyInstance } from "fastify";
import {
  readRawConfig,
  validateCandidate,
  writeConfig,
  configFileHash,
} from "@mcbot/core/utils/configService.js";
import { recordAdminAction } from "@mcbot/core/utils/adminAudit.js";
import { sessionFromRequest, isSysadmin, canManageGuild, guildScopeFresh } from "../auth.js";
import { listBotGuilds } from "../discordRest.js";
import type { RawBotConfig } from "@mcbot/core/types/index.js";

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
  /**
   * The guilds the current user may configure, each flagged configured
   * and with its enabled-feature keys — everything GuildsView and the
   * overview need, without exposing the rest of the config. Sysadmins see
   * every guild the bot is in; managers see only the ones they manage.
   */
  app.get("/api/guilds", async (req, reply) => {
    const session = sessionFromRequest(req)!;
    let botGuildIds: string[];
    try {
      botGuildIds = (await listBotGuilds()).map((g) => g.id);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: "discord_error", detail });
    }
    const visible = isSysadmin(session)
      ? botGuildIds
      : botGuildIds.filter((id) => session.guilds.includes(id));

    const cfg = readRawConfig();
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
  app.get<{ Params: { id: string } }>("/api/guilds/:id/config", async (req, reply) => {
    const session = sessionFromRequest(req)!;
    if (!canManageGuild(session, req.params.id)) {
      return reply.code(403).send({ error: "forbidden", detail: "You don't manage that guild." });
    }
    const cfg = readRawConfig();
    const block = (cfg.guilds ?? {})[req.params.id] ?? {};
    return { hash: configFileHash(), guildConfig: block };
  });

  /** Replace one guild's config block, validated and concurrency-checked. */
  app.put<{ Params: { id: string } }>("/api/guilds/:id/config", async (req, reply) => {
    const session = sessionFromRequest(req)!;
    const guildId = req.params.id;
    if (!canManageGuild(session, guildId)) {
      return reply.code(403).send({ error: "forbidden", detail: "You don't manage that guild." });
    }
    // A non-sysadmin's captured guild scope must still be fresh to WRITE
    // (SEC-03): if it has aged out, a demoted manager could otherwise keep
    // write access for the whole session, so require a re-login to re-derive
    // current permissions.
    if (!isSysadmin(session) && !guildScopeFresh(session)) {
      return reply.code(403).send({
        error: "forbidden",
        detail: "Your guild permissions may be out of date — please log in again.",
      });
    }

    const body = req.body as { baseHash?: string; guildConfig?: unknown };
    if (
      typeof body !== "object" || body === null ||
      typeof body.baseHash !== "string" ||
      typeof body.guildConfig !== "object" || body.guildConfig === null
    ) {
      return reply.code(400).send({ errors: ["Body must be { baseHash, guildConfig }"] });
    }

    // Same optimistic-concurrency contract as the full config PUT.
    const currentHash = configFileHash();
    if (body.baseHash !== currentHash) {
      return reply.code(409).send({
        error: "conflict",
        message: "Config changed since you loaded it. Reload and re-apply.",
        currentHash,
      });
    }

    // Build the new config from the current one on disk, replacing ONLY
    // this guild's block. The manager can't touch other guilds, servers,
    // or top-level settings — those are copied through untouched — then
    // the whole thing is validated as one.
    const current = readRawConfig();
    const merged: RawBotConfig = {
      ...current,
      guilds: { ...(current.guilds ?? {}), [guildId]: body.guildConfig as Record<string, unknown> },
    } as RawBotConfig;

    const result = validateCandidate(merged);
    if (!result.valid) {
      return reply.code(422).send({ errors: result.errors });
    }

    await writeConfig(merged);
    await recordAdminAction({
      action: "guild config write (dashboard)",
      by: session.tag,
      byId: session.uid,
      guildId,
    });
    return { ok: true, warnings: result.warnings };
  });
}
