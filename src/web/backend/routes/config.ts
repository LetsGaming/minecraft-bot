/**
 * Phase 2 — schema-driven config editing plus the Commands view payload.
 * Registered inside the requireAdminSession-gated scope (see server.ts).
 * Split out of server.ts in the QUAL-01 refactor (2026-07 audit).
 *
 * Write bodies are validated at the boundary from the shared TypeBox schema
 * (envelope only — the config's deep shape is validateCandidate's job), and
 * every failure is a typed error rendered by the one error handler. The
 * config *object* is still hand-validated in depth because it is generated,
 * not statically known.
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
import {
  listConfigHistory,
  getConfigSnapshot,
  RETENTION_DAYS as CONFIG_HISTORY_RETENTION_DAYS,
} from "@mcbot/core/utils/config/configHistory.js";
import { log } from "@mcbot/core/utils/logger.js";
import { readCommandManifest } from "@mcbot/core/utils/commands/commandManifest.js";
import { resolveCommandPolicy } from "@mcbot/core/utils/commands/commandPolicy.js";
import { COMMAND_OPTIONS } from "@mcbot/schema";
import { sessionFromRequest } from "../auth/auth.js";
import {
  HttpError,
  BadRequest,
  NotFound,
  Conflict,
  ValidationFailed,
  ServiceUnavailable,
} from "../errors.js";
import { readConfigSchema } from "../config/configSchema.js";
import { toSafeConfig, mergeSecretPlaceholders } from "../config/safeConfig.js";
import type { RawBotConfig } from "@mcbot/core/types/index.js";
import { ConfigWriteBody, IdParams, MutationResult } from "./schemas.js";

export function registerConfigRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  api.get("/api/config", async () => ({
    hash: configFileHash(),
    config: toSafeConfig(readRawConfig()),
  }));

  /**
   * Everything the Commands view needs in one call: the manifest the
   * bot wrote at startup (ALL commands, incl. disabled), the raw
   * override blocks at each scope, and the effective policy per
   * command per scope (so the UI can show what "inherit" resolves to).
   */
  api.get("/api/commands", async () => {
    const manifest = await readCommandManifest();
    if (!manifest) {
      throw new ServiceUnavailable(
        "Command manifest not written yet — start the bot once so it can discover its commands.",
      );
    }
    const raw = readRawConfig();
    const guildIds = Object.keys(raw.guilds ?? {});
    const serverIds = Object.keys(raw.servers ?? {});

    const effective = (
      name: string,
    ): Record<string, { enabled: boolean; adminOnly: boolean }> => {
      const out: Record<string, { enabled: boolean; adminOnly: boolean }> = {
        global: resolveCommandPolicy(name),
      };
      for (const gid of guildIds) {
        out[`guild:${gid}`] = resolveCommandPolicy(name, { guildId: gid });
      }
      for (const sid of serverIds) {
        out[`server:${sid}`] = resolveCommandPolicy(name, { serverId: sid });
      }
      return out;
    };

    return {
      manifest,
      scopes: { guildIds, serverIds },
      commandOptions: COMMAND_OPTIONS,
      overrides: {
        global: raw.commands ?? {},
        guilds: Object.fromEntries(
          guildIds.map((gid) => [gid, raw.guilds?.[gid]?.commands ?? {}]),
        ),
        servers: Object.fromEntries(
          serverIds.map((sid) => [sid, raw.servers?.[sid]?.commands ?? {}]),
        ),
      },
      effective: Object.fromEntries(
        [...manifest.slash, ...manifest.ingame].map((c) => [
          c.name,
          effective(c.name),
        ]),
      ),
    };
  });

  api.get("/api/config/schema", async () => {
    const schema = readConfigSchema();
    if (!schema) {
      throw new NotFound(
        "Config schema not generated yet — restart the bot so it can write it.",
      );
    }
    return schema;
  });

  api.put(
    "/api/config",
    { schema: { body: ConfigWriteBody, response: { 200: MutationResult } } },
    async (req) => {
      const { baseHash, config } = req.body;

      // Optimistic concurrency: the edit must be based on the config that
      // is on disk right now. Two dashboard admins — or an admin racing
      // the bot's own /config command — get a 409 instead of a silent
      // last-write-wins clobber.
      const currentHash = configFileHash();
      if (baseHash !== currentHash) {
        throw new Conflict(
          "config.json changed since you loaded it (another admin, the " +
            "bot, or a hand edit). Reload the config and re-apply your changes.",
          { currentHash },
        );
      }

      const current = readRawConfig();
      // `config` is the request body's config object (shape-checked by the
      // route schema as an object). validateCandidate(merged) below is the deep
      // gate that rejects a malformed config before anything is written.
      const merged = mergeSecretPlaceholders(config as RawBotConfig, current);

      const result = validateCandidate(merged);
      if (!result.valid) {
        throw new ValidationFailed(result.errors);
      }

      const session = sessionFromRequest(req)!;
      let changed = true;
      try {
        ({ changed } = await writeConfig(merged, {
          byTag: session.tag,
          byId: session.uid,
          note: "config write (dashboard)",
        }));
      } catch (err) {
        // writeConfig raises an actionable, operator-facing message (e.g. a
        // read-only/non-owned config path). Log it and surface it to the
        // sysadmin editing config rather than falling through to a generic 500.
        const msg = err instanceof Error ? err.message : "Failed to write config.";
        log.error("web", `Config write failed: ${msg}`);
        throw new HttpError(500, msg);
      }
      // Only record an audit entry when something actually changed — a Save with
      // no edits is a no-op, not an auditable action.
      if (changed) {
        await recordAdminAction({
          action: "config write (dashboard)",
          by: session.tag,
          byId: session.uid,
        });
      }
      return { ok: true, changed, warnings: result.warnings };
    },
  );

  // ── Config rollback history ──────────────────────────────────────────────
  // Snapshots of the config as it was before each write (last few days only;
  // see configHistory.ts). Reverting one restores that earlier state.
  api.get("/api/config/history", async () => ({
    retentionDays: CONFIG_HISTORY_RETENTION_DAYS,
    entries: listConfigHistory().map((e) => ({
      id: e.id,
      at: e.at,
      by: e.byTag,
      note: e.note,
    })),
  }));

  api.post(
    "/api/config/history/:id/rollback",
    { schema: { params: IdParams, response: { 200: MutationResult } } },
    async (req) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        throw new BadRequest("Invalid history entry id.");
      }
      const snapshot = getConfigSnapshot(id);
      if (snapshot === null) {
        throw new NotFound(
          `Config history entry ${id} not found — it may have aged out ` +
            `(history is kept for ${CONFIG_HISTORY_RETENTION_DAYS} days).`,
        );
      }

      let candidate: RawBotConfig;
      try {
        // A config snapshot this app itself wrote to the history table; assert
        // the shape on parse. It's validated as a candidate below before being
        // applied, and an unparseable snapshot throws a clear 500.
        candidate = JSON.parse(snapshot) as RawBotConfig;
      } catch {
        throw new HttpError(500, "Stored config snapshot is unreadable.");
      }

      const result = validateCandidate(candidate);
      if (!result.valid) {
        // A snapshot that no longer validates (e.g. it references a server
        // since removed) — surface why rather than a bare 422.
        throw new HttpError(
          422,
          "The snapshot is no longer valid against the current schema.",
          { errors: result.errors },
        );
      }

      const session = sessionFromRequest(req)!;
      let changed = true;
      try {
        ({ changed } = await writeConfig(candidate, {
          byTag: session.tag,
          byId: session.uid,
          note: `rollback to #${id}`,
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Rollback failed.";
        log.error("web", `Config rollback failed: ${msg}`);
        throw new HttpError(500, msg);
      }
      if (changed) {
        await recordAdminAction({
          action: `config rollback to #${id} (dashboard)`,
          by: session.tag,
          byId: session.uid,
        });
      }
      return { ok: true, changed, warnings: result.warnings };
    },
  );
}
