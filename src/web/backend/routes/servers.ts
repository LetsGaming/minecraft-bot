/**
 * Phase 3 — server operations: script actions (start/stop/restart/
 * backup), log tail, and stats pruning. Registered inside the
 * capability-gated host scope (see server.ts).
 *
 * Params/query are validated + typed from the shared schemas; the domain
 * guards (server exists, action allowed, wrapper capability present) throw
 * typed failures rendered by the one error handler. Authorization is separate
 * and earlier: each route declares the user capability it needs in `config`,
 * enforced by the host scope's onRequest gate (auth/capabilities.ts). SEC-04 stands: an internal
 * failure logs its detail and returns a fixed, path-free message.
 */
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  runScript,
  classifyScriptFailure,
  tailLog,
  listStatsUuids,
  deleteStatsFile,
  readWhitelist,
  readUserCache,
} from "@mcbot/core/utils/server/serverAccess.js";
import { scriptFailureError, scriptResultBody, type ScriptResultBody } from "./scriptFailure.js";
import { log } from "@mcbot/core/utils/logger.js";
import { readThrough } from "@mcbot/core/utils/wrapper/lastKnown.js";
import {
  recordIntent,
  listIntents,
  clearIntent,
} from "@mcbot/core/utils/wrapper/deferredIntents.js";
import { currentSession, type Session } from "../auth/auth.js";
import { BadRequest, Conflict, Forbidden, HttpError } from "../errors.js";
import { ServerActionParams, IdParams, LinesQuery, DryRunQuery } from "./schemas.js";
import { clampIntParam, flagParam } from "./query.js";
import { auditAction, requireServer, wrapperCall } from "./support.js";
import { isServerOperatorAction, capabilityForServerAction } from "@mcbot/schema/serverActions.js";
import { errMsg } from "@mcbot/core/utils/error.js";

const DEFAULT_LOG_LINES = 50;
const MAX_LOG_LINES = 500;

/**
 * Run one operator script on a server, after the route has authorized it.
 * Shared by the rollback route and the generic action route, which differ
 * only in the capability they demand.
 */
async function runServerAction(
  id: string,
  action: string,
  session: Session,
): Promise<ScriptResultBody> {
  const server = requireServer(id);
  // Kept as a guard (not a schema enum) so the "unknown server" 404 still
  // precedes the "unknown action" 400 — the order the API has always had.
  if (!isServerOperatorAction(action)) {
    throw new BadRequest(`unknown action "${action}"`);
  }
  // `action` is now a ServerScriptAction, so the capability lookup below
  // needs no cast — the guard is what proves the key is real.
  if (server.capabilities && !server.capabilities.scripts[action]) {
    throw new Conflict(`server has no ${action} script (suite not installed?)`);
  }

  await auditAction(session, { action, server: id });

  try {
    const result = await runScript(server.config, action);
    // Granted: the operator got what they were asking for, so stop
    // offering it back to them.
    clearIntent(id, action);
    return scriptResultBody(result);
  } catch (err) {
    log.error("web", `Script ${action} on ${id} failed: ${errMsg(err)}`);
    const failure = classifyScriptFailure(err);
    if (failure.kind !== "unreachable") throw scriptFailureError(action, failure);
    // Remember the wish, never the act. A restart or rollback that fires
    // by itself hours later kicks players nobody warned, or discards play
    // nobody meant to lose. The dashboard will offer this back as a
    // one-click retry once the wrapper answers, with a person present.
    recordIntent({
      serverId: id,
      action,
      attemptedAt: Date.now(),
      byTag: session.tag,
      reason: errMsg(err),
    });
    throw new HttpError(503, `The wrapper did not answer, so "${action}" did not run. It is offered again once the wrapper is back.`);
  }
}

export function registerServerRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  // server:control, not a per-action capability: start, stop, restart and
  // backup are all reversible and all interrupt the same people. The two
  // irreversible operations (restore, rollback) get their own routes and their
  // own capabilities rather than joining this one (RBAC-01).
  /** Actions that could not run while the wrapper was away, still offerable. */
  api.get(
    "/api/servers/:id/pending-actions",
    {
      schema: { params: IdParams },
      config: { capability: "server:read", scope: "server", param: "id" },
    },
    async (req) => ({ intents: listIntents(req.params.id) }),
  );

  api.delete(
    "/api/servers/:id/pending-actions/:action",
    {
      schema: { params: ServerActionParams },
      config: { capability: "server:control", scope: "server", param: "id" },
    },
    async (req) => {
      clearIntent(req.params.id, req.params.action);
      return { ok: true };
    },
  );

  // A rollback replaces the world from a snapshot and cannot be undone, so it
  // needs server:rollback, not server:control (AUD-003). The static segment
  // outranks the `:action` route below, so a rollback can never reach the
  // server:control rule.
  api.post(
    "/api/servers/:id/rollback",
    {
      schema: { params: IdParams },
      config: { capability: "server:rollback", scope: "server", param: "id" },
    },
    async (req) => runServerAction(req.params.id, "rollback", currentSession(req)),
  );

  api.post(
    "/api/servers/:id/:action",
    {
      schema: { params: ServerActionParams },
      config: { capability: "server:control", scope: "server", param: "id" },
    },
    async (req) => {
      const { id, action } = req.params;
      // Defense in depth: actions with a capability of their own (rollback)
      // are served by their dedicated route above.
      if (isServerOperatorAction(action)) {
        const needed = capabilityForServerAction(action);
        if (needed !== "server:control") {
          throw new Forbidden(`You don't have "${needed}" on this server.`);
        }
      }
      return runServerAction(id, action, currentSession(req));
    },
  );

  api.get(
    "/api/servers/:id/log",
    {
      schema: { params: IdParams, querystring: LinesQuery },
      config: { capability: "server:read", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);
      const n = clampIntParam(req.query.lines, {
        def: DEFAULT_LOG_LINES,
        min: 1,
        max: MAX_LOG_LINES,
      });
      // The last log we managed to read is the single most useful thing to
      // show when the wrapper stops answering: it very often contains the
      // reason it stopped answering.
      const { value, stale } = await wrapperCall("Log tail", { server: req.params.id }, () =>
        readThrough(req.params.id, "logTail", () => tailLog(server.config, n)),
      );
      return { lines: value.split("\n").filter(Boolean), stale };
    },
  );

  // Deleting stats files is destructive but bounded and re-derivable from the
  // server itself, so it sits with the other reversible operations rather than
  // earning a capability of its own.
  api.post(
    "/api/servers/:id/prune-stats",
    {
      schema: { params: IdParams, querystring: DryRunQuery },
      config: { capability: "server:control", scope: "server", param: "id" },
    },
    async (req) => {
      const server = requireServer(req.params.id);

      // Same rule as /server prune-stats: a UUID is prunable when
      // neither the whitelist nor the usercache can name it. That rule turns
      // "could not read the lists" into "every player is unknown", so a
      // failed or empty read refuses instead of pruning (AUD-004).
      let uuids: string[];
      let whitelist: Awaited<ReturnType<typeof readWhitelist>>;
      let usercache: Awaited<ReturnType<typeof readUserCache>>;
      try {
        [uuids, whitelist, usercache] = await Promise.all([
          listStatsUuids(server.config),
          readWhitelist(server.config),
          readUserCache(server.config),
        ]);
      } catch (err) {
        log.error("web", `prune-stats on ${req.params.id}: reading players failed: ${errMsg(err)}`);
        throw new HttpError(
          503,
          "Could not read the whitelist or usercache, so nothing was pruned: without them every player's stats would look orphaned.",
        );
      }
      if (!Array.isArray(whitelist)) whitelist = [];
      if (whitelist.length === 0 && usercache.length === 0) {
        throw new Conflict(
          "The whitelist and usercache are both empty, so nothing was pruned: every player's stats would look orphaned.",
        );
      }
      const known = new Set(
        [...whitelist, ...usercache]
          .map((e) => (e.uuid ?? "").toLowerCase())
          .filter(Boolean),
      );
      const prunable = uuids.filter((u) => !known.has(u.toLowerCase()));

      if (flagParam(req.query.dryRun)) {
        return { dryRun: true, prunable };
      }

      const session = currentSession(req);
      let deleted = 0;
      for (const uuid of prunable) {
        if (await deleteStatsFile(server.config, uuid)) deleted += 1;
      }
      await auditAction(session, {
        action: "prune-stats",
        server: req.params.id,
        detail: `${deleted} stats file(s) deleted`,
      });
      return { dryRun: false, deleted, prunable };
    },
  );
}
