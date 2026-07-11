/**
 * Phase 2 — schema-driven config editing plus the Commands view payload.
 * Registered inside the requireAdminSession-gated scope (see server.ts).
 * Split out of server.ts in the QUAL-01 refactor (2026-07 audit).
 */
import type { FastifyInstance } from "fastify";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  readRawConfig,
  validateCandidate,
  writeConfig,
  configFileHash,
} from "@mcbot/core/utils/configService.js";
import { recordAdminAction } from "@mcbot/core/utils/adminAudit.js";
import {
  listConfigHistory,
  getConfigSnapshot,
  RETENTION_DAYS as CONFIG_HISTORY_RETENTION_DAYS,
} from "@mcbot/core/utils/configHistory.js";
import { log } from "@mcbot/core/utils/logger.js";
import { readCommandManifest } from "@mcbot/core/utils/commandManifest.js";
import { resolveCommandPolicy } from "@mcbot/core/utils/commandPolicy.js";
import { COMMAND_OPTIONS } from "@mcbot/schema";
import { sessionFromRequest } from "../auth.js";
import { HttpError, BadRequest, NotFound } from "../errors.js";
import { toSafeConfig, mergeSecretPlaceholders } from "../safeConfig.js";
import type { RawBotConfig } from "@mcbot/core/types/index.js";
import type { ConfigWriteRequest } from "@mcbot/schema/contract.js";

export function registerConfigRoutes(api: FastifyInstance): void {
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
  api.get("/api/commands", async (_req, reply) => {
    const manifest = await readCommandManifest();
    if (!manifest) {
      return reply.code(503).send({
        error:
          "Command manifest not written yet — start the bot once so it can discover its commands.",
      });
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

  api.get("/api/config/schema", async (_req, reply) => {
    // One directory deeper than the pre-split server.ts, so one more
    // ".." — the resolved target is unchanged in both the source tree
    // (vitest) and the compiled tree (dist/backend/routes/config.js).
    const schemaPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "..",
      "config.schema.json",
    );
    try {
      const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
      return schema;
    } catch {
      return reply.code(404).send({
        error:
          "Config schema not generated yet — restart the bot so it can write it.",
      });
    }
  });

  api.put("/api/config", async (req, reply) => {
    const body = req.body as ConfigWriteRequest;
    if (
      typeof body !== "object" ||
      body === null ||
      typeof body.baseHash !== "string" ||
      typeof body.config !== "object" ||
      body.config === null
    ) {
      return reply
        .code(400)
        .send({ errors: ["Body must be { baseHash, config }"] });
    }

    // Optimistic concurrency: the edit must be based on the config that
    // is on disk right now. Two dashboard admins — or an admin racing
    // the bot's own /config command — get a 409 instead of a silent
    // last-write-wins clobber.
    const currentHash = configFileHash();
    if (body.baseHash !== currentHash) {
      return reply.code(409).send({
        error:
          "config.json changed since you loaded it (another admin, the " +
          "bot, or a hand edit). Reload the config and re-apply your changes.",
        currentHash,
      });
    }

    const submitted = body.config as RawBotConfig;
    const current = readRawConfig();
    const merged = mergeSecretPlaceholders(submitted, current);

    const result = validateCandidate(merged);
    if (!result.valid) {
      return reply.code(422).send({ errors: result.errors });
    }

    const session = sessionFromRequest(req)!;
    try {
      await writeConfig(merged, {
        byTag: session.tag,
        byId: session.uid,
        note: "config write (dashboard)",
      });
    } catch (err) {
      // writeConfig raises an actionable, operator-facing message (e.g. a
      // read-only/non-owned config path). Log it and surface it to the
      // sysadmin editing config rather than falling through to a generic 500.
      const msg = err instanceof Error ? err.message : "Failed to write config.";
      log.error("web", `Config write failed: ${msg}`);
      throw new HttpError(500, msg);
    }
    await recordAdminAction({
      action: "config write (dashboard)",
      by: session.tag,
      byId: session.uid,
    });
    return { ok: true, warnings: result.warnings };
  });

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

  api.post<{ Params: { id: string } }>(
    "/api/config/history/:id/rollback",
    async (req, reply) => {
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
        candidate = JSON.parse(snapshot) as RawBotConfig;
      } catch {
        throw new HttpError(500, "Stored config snapshot is unreadable.");
      }

      const result = validateCandidate(candidate);
      if (!result.valid) {
        // A snapshot that no longer validates (e.g. it references a server
        // since removed) — surface why rather than a bare 422.
        return reply.code(422).send({
          error: "The snapshot is no longer valid against the current schema.",
          errors: result.errors,
        });
      }

      const session = sessionFromRequest(req)!;
      try {
        await writeConfig(candidate, {
          byTag: session.tag,
          byId: session.uid,
          note: `rollback to #${id}`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Rollback failed.";
        log.error("web", `Config rollback failed: ${msg}`);
        throw new HttpError(500, msg);
      }
      await recordAdminAction({
        action: `config rollback to #${id} (dashboard)`,
        by: session.tag,
        byId: session.uid,
      });
      return { ok: true, warnings: result.warnings };
    },
  );
}
