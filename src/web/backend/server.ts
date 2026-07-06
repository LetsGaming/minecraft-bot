/**
 * Dashboard backend — one Fastify instance, built by buildServer() so
 * route tests can use fastify.inject without binding a port.
 *
 * This file is the ASSEMBLER (QUAL-01 refactor, 2026-07 audit): it owns
 * instance creation, the auth boundary, and registration order. The
 * behavior lives in focused modules — mirroring what the wrapper does
 * with its app.ts.
 *
 * Route map (docs/dev/webui-integration.md):
 *   /auth/login|callback|logout    Discord OAuth2        routes/auth.ts
 *   /api/me                        session probe         routes/auth.ts
 *   /api/status                    phase 1: live status  routes/monitoring.ts
 *   /api/uptime/:serverId          phase 1: uptime       routes/monitoring.ts
 *   /api/activity/:serverId        phase 1: activity     routes/monitoring.ts
 *   /api/audit                     phase 1: audit log    routes/monitoring.ts
 *   /api/config (+/schema, PUT)    phase 2: config edit  routes/config.ts
 *   /api/commands                  phase 2: policy view  routes/config.ts
 *   POST /api/servers/:id/:action  phase 3: scripts      routes/servers.ts
 *   GET  /api/servers/:id/log      phase 3: log tail     routes/servers.ts
 *   POST /api/servers/:id/prune-stats  phase 3           routes/servers.ts
 *   /healthz, /metrics             unauthenticated       metrics.ts
 *   everything else                static Vue frontend   static.ts
 *
 * The web process may import @mcbot/core and @mcbot/schema only (ESLint boundary): status
 * comes from the same ServerInstance layer the bot uses, config writes
 * go through configService.writeConfig — never through the bot.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { loadConfig } from "@mcbot/core/config.js";
import { log } from "@mcbot/core/utils/logger.js";
import { requireAdminSession } from "./auth.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerMonitoringRoutes } from "./routes/monitoring.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerServerRoutes } from "./routes/servers.js";
import { registerProbeRoutes } from "./metrics.js";
import { registerStaticFrontend } from "./static.js";

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy: true });

  // ── Auth (the only routes outside the session gate) ──
  registerAuthRoutes(app);

  // ── Authenticated API ── every /api route registered in this scope
  // sits behind requireAdminSession; adding a route module here is the
  // ONLY way it should ever be exposed.
  app.register(async (api) => {
    api.addHook("preHandler", requireAdminSession);
    registerMonitoringRoutes(api); // phase 1 — read-only
    registerConfigRoutes(api);     // phase 2 — schema-driven editing
    registerServerRoutes(api);     // phase 3 — operations
  });

  // ── Unauthenticated probes ──
  registerProbeRoutes(app);

  // ── Static frontend (everything unmatched) ──
  registerStaticFrontend(app);

  return app;
}

export async function startWebServer(): Promise<FastifyInstance> {
  const cfg = loadConfig();
  // Env beats config (same contract as every other secret/deploy knob):
  // config.json is shared with the bot, so per-environment bind details
  // like "0.0.0.0 inside the container" belong to the environment.
  const port =
    Number(process.env.WEBUI_PORT) || cfg.webui?.port || 8130;
  const host = process.env.WEBUI_HOST ?? cfg.webui?.host ?? "127.0.0.1";

  const app = buildServer();
  await app.listen({ port, host });
  log.info("web", `Dashboard listening on http://${host}:${port}`);
  return app;
}
