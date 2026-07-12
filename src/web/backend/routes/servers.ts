/**
 * Phase 3 — server operations: script actions (start/stop/restart/
 * backup), log tail, and stats pruning. Registered inside the
 * requireAdminSession-gated scope (see server.ts). Split out of
 * server.ts in the QUAL-01 refactor (2026-07 audit).
 *
 * Params/query are validated + typed from the shared schemas; the domain
 * guards (server exists, action allowed, capability present) throw typed
 * failures rendered by the one error handler. SEC-04 stands: an internal
 * failure logs its detail and returns a fixed, path-free message.
 */
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { getServerInstance } from "@mcbot/core/utils/server.js";
import {
  runScript,
  tailLog,
  listStatsUuids,
  deleteStatsFile,
  readWhitelist,
  readUserCache,
} from "@mcbot/core/utils/serverAccess.js";
import { recordAdminAction } from "@mcbot/core/utils/adminAudit.js";
import { log } from "@mcbot/core/utils/logger.js";
import { sessionFromRequest } from "../auth.js";
import { BadRequest, NotFound, Conflict, HttpError } from "../errors.js";
import { ServerActionParams, IdParams, LinesQuery, DryRunQuery } from "./schemas.js";

const SCRIPT_ACTIONS = new Set(["start", "stop", "restart", "backup"]);

/** The generic message returned when a server-side operation fails: SEC-04
 *  keeps absolute paths and sudo/stderr fragments out of the browser. */
const OPERATION_FAILED = "The operation failed unexpectedly — see the bot logs for details.";

/** Resolve a configured server or throw the shared 404 — the one place the
 *  "no such server" contract lives, instead of repeating it per route. */
function requireServer(id: string): NonNullable<ReturnType<typeof getServerInstance>> {
  const server = getServerInstance(id);
  if (!server) throw new NotFound(`No server named "${id}" is configured.`);
  return server;
}

export function registerServerRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  api.post(
    "/api/servers/:id/:action",
    { schema: { params: ServerActionParams } },
    async (req) => {
      const { id, action } = req.params;
      const server = requireServer(id);
      // Kept as a guard (not a schema enum) so the "unknown server" 404 still
      // precedes the "unknown action" 400 — the order the API has always had.
      if (!SCRIPT_ACTIONS.has(action)) {
        throw new BadRequest(`unknown action "${action}"`);
      }
      if (server.capabilities && !server.capabilities.scripts[action as "start"]) {
        throw new Conflict(`server has no ${action} script (suite not installed?)`);
      }

      const session = sessionFromRequest(req)!;
      await recordAdminAction({
        action: `${action} (dashboard)`,
        server: id,
        by: session.tag,
        byId: session.uid,
      });

      try {
        const result = await runScript(server.config, action);
        return {
          ok: result.exitCode === 0,
          exitCode: result.exitCode,
          output: result.output.slice(-4000),
          stderr: result.stderr.slice(-4000),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("web", `Script ${action} on ${id} failed: ${msg}`);
        throw new HttpError(500, OPERATION_FAILED);
      }
    },
  );

  api.get(
    "/api/servers/:id/log",
    { schema: { params: IdParams, querystring: LinesQuery } },
    async (req) => {
      const server = requireServer(req.params.id);
      const n = Math.min(Math.max(parseInt(req.query.lines ?? "50", 10) || 50, 1), 500);
      try {
        const raw = await tailLog(server.config, n);
        return { lines: raw.split("\n").filter(Boolean) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("web", `Log tail for ${req.params.id} failed: ${msg}`);
        throw new HttpError(500, OPERATION_FAILED);
      }
    },
  );

  api.post(
    "/api/servers/:id/prune-stats",
    { schema: { params: IdParams, querystring: DryRunQuery } },
    async (req) => {
      const server = requireServer(req.params.id);

      // Same rule as /server prune-stats: a UUID is prunable when
      // neither the whitelist nor the usercache can name it.
      const [uuids, whitelist, usercache] = await Promise.all([
        listStatsUuids(server.config),
        readWhitelist(server.config).catch(() => []),
        readUserCache(server.config).catch(() => []),
      ]);
      const known = new Set(
        [...whitelist, ...usercache]
          .map((e) => (e.uuid ?? "").toLowerCase())
          .filter(Boolean),
      );
      const prunable = uuids.filter((u) => !known.has(u.toLowerCase()));

      const { dryRun } = req.query;
      if (dryRun === "1" || dryRun === "true") {
        return { dryRun: true, prunable };
      }

      const session = sessionFromRequest(req)!;
      let deleted = 0;
      for (const uuid of prunable) {
        if (await deleteStatsFile(server.config, uuid)) deleted += 1;
      }
      await recordAdminAction({
        action: "prune-stats (dashboard)",
        server: req.params.id,
        by: session.tag,
        byId: session.uid,
        detail: `${deleted} stats file(s) deleted`,
      });
      return { dryRun: false, deleted, prunable };
    },
  );
}
