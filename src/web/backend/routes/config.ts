/**
 * Phase 2 — schema-driven config editing plus the Commands view payload.
 * Registered inside the capability-gated host scope (see server.ts).
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
  withConfigWriteLock,
  configFileHash,
} from "@mcbot/core/utils/config/configService.js";
import {
  listConfigHistory,
  getConfigSnapshot,
  RETENTION_DAYS as CONFIG_HISTORY_RETENTION_DAYS,
} from "@mcbot/core/utils/config/configHistory.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { readRuntimeHeartbeat } from "@mcbot/core/utils/server/runtimeHeartbeat.js";
import {
  computeConfigStatus,
  readConfigRevision,
} from "@mcbot/core/utils/config/configApplyStatus.js";
import { readCommandManifest } from "@mcbot/core/utils/commands/commandManifest.js";
import { buildCommandsView } from "@mcbot/core/utils/commands/commandsView.js";
import { currentSession, type Session } from "../auth/auth.js";
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
import type { CapabilityRule } from "../auth/capabilities.js";
import { auditAction } from "./support.js";

/**
 * Every route in this file reads or writes config.json, which carries the
 * Discord token and every RCON password. `bot:config` is therefore sysadmin by
 * definition and can never appear in a grant (schema/capabilities.ts) — named
 * once here rather than repeated per route.
 */
const BOT_CONFIG = {
  capability: "bot:config",
  scope: "global",
} as const satisfies CapabilityRule;

/**
 * Write a validated config under the caller's name. The audit entry is only
 * recorded when something changed: a Save with no edits is a no-op, not an
 * auditable action. `writeConfig` raises an actionable, operator-facing
 * message (e.g. a read-only or non-owned config path), which is surfaced to
 * the sysadmin editing config rather than falling through to a generic 500.
 */
async function applyConfigWrite(
  candidate: RawBotConfig,
  session: Session,
  entry: { note: string; audit: string; warnings: string[] },
): Promise<{ ok: true; changed: boolean; warnings: string[] }> {
  let changed: boolean;
  try {
    ({ changed } = await writeConfig(candidate, {
      byTag: session.tag,
      byId: session.uid,
      note: entry.note,
    }));
  } catch (err) {
    const msg = errMsg(err);
    log.error("web", `${entry.note} failed: ${msg}`);
    throw new HttpError(500, msg);
  }
  if (changed) await auditAction(session, { action: entry.audit });
  return { ok: true, changed, warnings: entry.warnings };
}

export function registerConfigRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  api.get("/api/config", { config: BOT_CONFIG }, async () => ({
    hash: configFileHash(),
    config: toSafeConfig(readRawConfig()),
  }));

  /**
   * Whether the running bot has applied the config.json on disk: the file's
   * revision next to what the bot's heartbeat last reported applying.
   */
  api.get("/api/config/status", { config: BOT_CONFIG }, async () =>
    computeConfigStatus(
      readConfigRevision(configFileHash()),
      await readRuntimeHeartbeat(),
    ),
  );

  /**
   * Everything the Commands view needs in one call: the manifest the
   * bot wrote at startup (ALL commands, incl. disabled), the raw
   * override blocks at each scope, and the effective policy per
   * command per scope (so the UI can show what "inherit" resolves to).
   */
  api.get("/api/commands", { config: BOT_CONFIG }, async () => {
    const manifest = await readCommandManifest();
    if (!manifest) {
      throw new ServiceUnavailable(
        "Command manifest not written yet. Start the bot once so it can discover its commands.",
      );
    }
    // Hashed before the read: a write landing in between leaves the token
    // older than the content, which only ever makes a later save conflict.
    const hash = configFileHash();
    return buildCommandsView({ manifest, raw: readRawConfig(), hash });
  });

  api.get("/api/config/schema", { config: BOT_CONFIG }, async () => {
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
    {
      schema: { body: ConfigWriteBody, response: { 200: MutationResult } },
      config: BOT_CONFIG,
    },
    async (req) => {
      const { baseHash, config } = req.body;

      // The check and the write happen under one lock (AUD-014).
      return withConfigWriteLock(async () => {
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

        return applyConfigWrite(merged, currentSession(req), {
          note: "config write (dashboard)",
          audit: "config write",
          warnings: result.warnings,
        });
      });
    },
  );

  // ── Config rollback history ──────────────────────────────────────────────
  // Snapshots of the config as it was before each write (last few days only;
  // see configHistory.ts). Reverting one restores that earlier state.
  api.get("/api/config/history", { config: BOT_CONFIG }, async () => ({
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
    {
      // `:id` is a config-history entry, NOT a server. Hence "global": a
      // server-scoped rule would have read this param as a server id.
      schema: { params: IdParams, response: { 200: MutationResult } },
      config: BOT_CONFIG,
    },
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

      return withConfigWriteLock(async () => {
        return applyConfigWrite(candidate, currentSession(req), {
          note: `rollback to #${id}`,
          audit: `config rollback to #${id}`,
          warnings: result.warnings,
        });
      });
    },
  );
}
