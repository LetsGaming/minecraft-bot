/**
 * Phase 1 — read-only monitoring routes: live status, uptime stats,
 * player-count activity series, and the admin audit log. Registered
 * inside the capability-gated host scope (see server.ts). Split out of
 * server.ts in the QUAL-01 refactor (2026-07 audit).
 *
 * Every route declares its capability in `config`; /api/status is `any` and
 * filters its collection, because a per-server grantee may see their own
 * servers and must not see the rest (RBAC-02).
 *
 * Route params/query are validated + typed from the shared TypeBox schemas
 * (routes/schemas.ts) instead of an `as` cast at the edge; a missing/unknown
 * server is a typed NotFound through the one error handler, not a hand-built
 * reply.code().send() (fastify.md).
 */
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { getServerIds } from "@mcbot/core/config.js";
import { getUptimeStats } from "@mcbot/core/utils/stores/uptimeTracker.js";
import { loadAdminAudit } from "@mcbot/core/utils/stores/adminAudit.js";
import {
  readRuntimeHeartbeat,
  heartbeatIsFresh,
} from "@mcbot/core/utils/server/runtimeHeartbeat.js";
import { loadPlayerCountStore } from "@mcbot/core/utils/stores/playerCountHistory.js";
import { collectStatus, unknownStatus } from "../status/status.js";
import { sessionFromRequest } from "../auth/auth.js";
import { visibleServerIds } from "../auth/capabilities.js";
import { NotFound } from "../errors.js";
import { ServerIdParams, LimitQuery } from "./schemas.js";

/** Clamp a caller-supplied "how many" query to [1, max], defaulting when absent
 *  or unparseable. A domain rule, so it lives here rather than in the schema. */
function clampCount(raw: string | undefined, fallback: number, max: number): number {
  return Math.min(Math.max(parseInt(raw ?? String(fallback), 10) || fallback, 1), max);
}

function knownServer(serverId: string): void {
  if (!getServerIds().includes(serverId)) {
    throw new NotFound(`No server named "${serverId}" is configured.`);
  }
}

export function registerMonitoringRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();

  // "any": a per-server grantee may reach this, and the handler filters the
  // collection to what they hold server:read on (RBAC-02, visibleServerIds).
  api.get(
    "/api/status",
    { config: { capability: "server:read", scope: "any" } },
    async (req) => {
      const beat = await readRuntimeHeartbeat();
      const session = sessionFromRequest(req)!;
      const servers = await Promise.all(
        visibleServerIds(session, getServerIds()).map((id) =>
          collectStatus(id).catch(() => unknownStatus(id)),
        ),
      );
      return {
        bot: {
          alive: heartbeatIsFresh(beat),
          lastBeat: beat?.at ?? null,
          startedAt: beat?.startedAt ?? null,
          version: beat?.version ?? null,
        },
        servers,
      };
    },
  );

  api.get(
    "/api/uptime/:serverId",
    {
      schema: { params: ServerIdParams },
      config: { capability: "server:read", scope: "server", param: "serverId" },
    },
    async (req) => {
      knownServer(req.params.serverId);
      return getUptimeStats(req.params.serverId);
    },
  );

  api.get(
    "/api/activity/:serverId",
    {
      schema: { params: ServerIdParams },
      config: { capability: "server:read", scope: "server", param: "serverId" },
    },
    async (req) => {
      const { serverId } = req.params;
      knownServer(serverId);
      const store = await loadPlayerCountStore();
      return { serverId, series: store.servers[serverId] ?? [] };
    },
  );

  // The audit log is fleet-wide, so reading it is a fleet-wide grant:
  // "global" checks the wildcard block only. A single-server grantee must not
  // learn what happened on servers they were not given.
  api.get(
    "/api/audit",
    {
      schema: { querystring: LimitQuery },
      config: { capability: "audit:read", scope: "global" },
    },
    async (req) => {
      const entries = await loadAdminAudit();
      const n = clampCount(req.query.limit, 100, 500);
      return { entries: entries.slice(-n).reverse() };
    },
  );
}
