/**
 * Phase 1 — read-only monitoring routes: live status, uptime stats,
 * player-count activity series, and the admin audit log. Registered
 * inside the requireAdminSession-gated scope (see server.ts). Split out
 * of server.ts in the QUAL-01 refactor (2026-07 audit).
 */
import type { FastifyInstance } from "fastify";
import { getServerIds } from "@mcbot/core/config.js";
import { getUptimeStats } from "@mcbot/core/utils/uptimeTracker.js";
import { loadAdminAudit } from "@mcbot/core/utils/adminAudit.js";
import {
  readRuntimeHeartbeat,
  heartbeatIsFresh,
} from "@mcbot/core/utils/runtimeHeartbeat.js";
import { loadPlayerCountStore } from "@mcbot/core/utils/playerCountHistory.js";
import { collectStatus, offlineStatus } from "../status.js";

export function registerMonitoringRoutes(api: FastifyInstance): void {
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

  api.get("/api/uptime/:serverId", async (req, reply) => {
    const { serverId } = req.params as { serverId: string };
    if (!getServerIds().includes(serverId)) {
      return reply.code(404).send({ error: "unknown server" });
    }
    return getUptimeStats(serverId);
  });

  api.get("/api/activity/:serverId", async (req, reply) => {
    const { serverId } = req.params as { serverId: string };
    if (!getServerIds().includes(serverId)) {
      return reply.code(404).send({ error: "unknown server" });
    }
    const store = await loadPlayerCountStore();
    return { serverId, series: store.servers[serverId] ?? [] };
  });

  api.get("/api/audit", async (req) => {
    const { limit } = req.query as { limit?: string };
    const entries = await loadAdminAudit();
    const n = Math.min(Math.max(parseInt(limit ?? "100", 10) || 100, 1), 500);
    return { entries: entries.slice(-n).reverse() };
  });
}
