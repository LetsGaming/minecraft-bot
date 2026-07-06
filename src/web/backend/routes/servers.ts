/**
 * Phase 3 — server operations: script actions (start/stop/restart/
 * backup), log tail, and stats pruning. Registered inside the
 * requireAdminSession-gated scope (see server.ts). Split out of
 * server.ts in the QUAL-01 refactor (2026-07 audit).
 */
import type { FastifyInstance } from "fastify";
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

const SCRIPT_ACTIONS = new Set(["start", "stop", "restart", "backup"]);

export function registerServerRoutes(api: FastifyInstance): void {
  api.post("/api/servers/:id/:action", async (req, reply) => {
    const { id, action } = req.params as { id: string; action: string };
    const server = getServerInstance(id);
    if (!server) return reply.code(404).send({ error: "unknown server" });
    if (!SCRIPT_ACTIONS.has(action)) {
      return reply.code(400).send({ error: `unknown action "${action}"` });
    }
    if (server.capabilities && !server.capabilities.scripts[action as "start"]) {
      return reply
        .code(409)
        .send({ error: `server has no ${action} script (suite not installed?)` });
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
      // SEC-04: raw err.message leaks absolute paths and sudo/stderr
      // fragments to the browser — log the detail, return a fixed body.
      const msg = err instanceof Error ? err.message : String(err);
      log.error("web", `Script ${action} on ${id} failed: ${msg}`);
      return reply.code(500).send({ error: "internal error" });
    }
  });

  api.get("/api/servers/:id/log", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { lines } = req.query as { lines?: string };
    const server = getServerInstance(id);
    if (!server) return reply.code(404).send({ error: "unknown server" });
    const n = Math.min(Math.max(parseInt(lines ?? "50", 10) || 50, 1), 500);
    try {
      const raw = await tailLog(server.config, n);
      return { lines: raw.split("\n").filter(Boolean) };
    } catch (err) {
      // SEC-04: same defense-in-depth as the scripts route above.
      const msg = err instanceof Error ? err.message : String(err);
      log.error("web", `Log tail for ${id} failed: ${msg}`);
      return reply.code(500).send({ error: "internal error" });
    }
  });

  api.post("/api/servers/:id/prune-stats", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { dryRun } = req.query as { dryRun?: string };
    const server = getServerInstance(id);
    if (!server) return reply.code(404).send({ error: "unknown server" });

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
      server: id,
      by: session.tag,
      byId: session.uid,
      detail: `${deleted} stats file(s) deleted`,
    });
    return { dryRun: false, deleted, prunable };
  });
}
