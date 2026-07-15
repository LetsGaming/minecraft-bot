/**
 * Phase 1 — read-only monitoring routes: live status, uptime stats,
 * player-count activity series, and the admin audit log. Registered
 * inside the requireAdminSession-gated scope (see server.ts). Split out
 * of server.ts in the QUAL-01 refactor (2026-07 audit).
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
import { collectStatus, offlineStatus } from "../status/status.js";
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

  api.get("/api/status", async () => {
    const beat = await readRuntimeHeartbeat();
    const servers = await Promise.all(
      getServerIds().map((id) =>
        collectStatus(id).catch(() => offlineStatus(id)),
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
  });

  api.get(
    "/api/uptime/:serverId",
    { schema: { params: ServerIdParams } },
    async (req) => {
      knownServer(req.params.serverId);
      return getUptimeStats(req.params.serverId);
    },
  );

  api.get(
    "/api/activity/:serverId",
    { schema: { params: ServerIdParams } },
    async (req) => {
      const { serverId } = req.params;
      knownServer(serverId);
      const store = await loadPlayerCountStore();
      return { serverId, series: store.servers[serverId] ?? [] };
    },
  );

  api.get("/api/audit", { schema: { querystring: LimitQuery } }, async (req) => {
    const entries = await loadAdminAudit();
    const n = clampCount(req.query.limit, 100, 500);
    return { entries: entries.slice(-n).reverse() };
  });
}
