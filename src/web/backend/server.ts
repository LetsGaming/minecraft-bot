/**
 * Dashboard backend: one Fastify instance, built by buildServer() so
 * route tests can use fastify.inject without binding a port.
 *
 * This file is the ASSEMBLER: it owns instance creation, the auth boundary,
 * and registration order. The behavior lives in focused modules under
 * routes/, each declaring its own paths and the capability it needs. The
 * registered route table is `app.printRoutes()`.
 *
 * The web process may import @mcbot/core and @mcbot/schema only (ESLint boundary): status
 * comes from the same ServerInstance layer the bot uses, config writes
 * go through configService.writeConfig, never through the bot.
 */
import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import { loadConfig } from "@mcbot/core/config.js";
import { log } from "@mcbot/core/utils/logger.js";
import { registerErrorHandler } from "./errors.js";
import {
  createProxyMisconfigurationWarning,
  createTrustProxyFn,
} from "./trustProxy.js";
import { registerSetupGuard } from "./requiredEnv.js";
import { DISCORD_CDN_URL } from "@mcbot/schema";
import { requireSession, assertDevAuthBypassSafe } from "./auth/auth.js";
import {
  capabilityGate,
  assertCapabilitiesDeclared,
} from "./auth/capabilities.js";
import { registerRateLimiting } from "./rateLimit.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerMonitoringRoutes } from "./routes/monitoring.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerServerRoutes } from "./routes/servers.js";
import { registerConsoleRoutes } from "./routes/console.js";
import { registerBackupRoutes } from "./routes/backups.js";
import { registerModConfigRoutes } from "./routes/modConfigs.js";
import { registerRewardsRoutes } from "./routes/rewards.js";
import { registerModRoutes } from "./routes/mods.js";
import { registerUpgradeRoutes } from "./routes/upgrades.js";
import { registerPruneRoutes } from "./routes/prune.js";
import { registerAnalyticsRoutes } from "./routes/analytics.js";
import { registerPlayerRoutes } from "./routes/players.js";
import { registerSetupRoutes } from "./routes/setup.js";
import { registerGuildConfigRoutes } from "./routes/guildConfig.js";
import { registerProbeRoutes } from "./status/metrics.js";
import { registerStaticFrontend } from "./static.js";
import { registerCsrfGuard } from "./csrf.js";

export function buildServer(): FastifyInstance {
  const trustProxy = createTrustProxyFn(() => loadConfig().webui?.trustProxy);
  const app = Fastify({ logger: false, trustProxy });
  const warnIfProxyUntrusted = createProxyMisconfigurationWarning(trustProxy);
  app.addHook("onRequest", async (req) => {
    warnIfProxyUntrusted(req.raw.socket.remoteAddress, req.headers);
  });

  // ── Security headers (SEC-01) ── registered first so they apply to every
  // response, including the OAuth surface and the static SPA. The CSP is
  // tuned for this app: PrimeVue injects inline styles (style-src
  // 'unsafe-inline'), guild icons load from Discord's CDN (img-src), and the
  // SPA's JS is Vite-bundled from our own origin (script-src 'self', no inline).
  // frame-ancestors 'none' + X-Frame-Options: DENY close the clickjacking gap.
  // upgrade-insecure-requests is left off: TLS is terminated by the reverse
  // proxy in front (see docker-compose.yml), and forcing it would break a
  // plain-http internal/dev deployment.
  void app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", DISCORD_CDN_URL],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    frameguard: { action: "deny" },
  });

  // ── Required-config guard ── if a required secret (WEBUI_SESSION_SECRET /
  // WEBUI_CLIENT_SECRET) is missing, serve a clear setup page instead of
  // booting into a broken state where the first session op throws an opaque
  // 500. Registers nothing when everything is set. Runs right after helmet so
  // the page still gets security headers, and before the routes so it wins.
  registerSetupGuard(app);

  // ── Rate limiting (SEC-02) ── one shared token-bucket over /auth/* and
  // mutating /api/* (see rateLimit.ts). Runs before the auth gate so login
  // and write abuse is rejected early.
  registerRateLimiting(app);

  // ── Cross-site writes (AUD-017) ── a mutating /api request from a browser
  // must come from this origin; SameSite=Lax alone lets a sibling port or
  // subdomain post with the user's cookie.
  registerCsrfGuard(app);

  // ── Central error handler (QUAL-10) ── one place maps thrown failures to a
  // consistent response: typed HttpErrors render at their status; unexpected
  // faults become a generic 500 with the detail logged, never leaked.
  registerErrorHandler(app);

  // ── Auth (the only routes outside the session gate) ──
  registerAuthRoutes(app);

  // ── Host API ── server status/operations, host metrics, the full config,
  // and the audit log. Everything here reaches the Minecraft host, so every
  // route declares the capability it needs and the gate enforces it per
  // request (RBAC-02). Sysadmins hold every capability implicitly, so this is
  // a widening for delegation, not a change for the operator.
  app.register(async (api) => {
    // Registered before the routes: onRoute fires as each one registers, so a
    // route with no declared capability throws here during buildServer()
    // rather than serving unguarded (RBAC-03).
    assertCapabilitiesDeclared(api);
    // onRequest (not preHandler) so the auth gate fails closed BEFORE Fastify
    // validates a route's body schema, an unauthenticated caller gets 401,
    // never a 400 that would confirm the endpoint's body shape to a stranger.
    // Routing has already happened at this point, so req.params is populated
    // and a server-scoped rule can read it.
    api.addHook("onRequest", capabilityGate);
    registerMonitoringRoutes(api); // status + audit — read-only
    registerConfigRoutes(api);     // full schema-driven config editing
    registerServerRoutes(api);     // start/stop/restart/backup, log tail
    registerConsoleRoutes(api);    // live console: SSE relay + command input
    registerBackupRoutes(api);     // archive index, streamed download, restore
    registerModConfigRoutes(api);  // mod config editor: index, read, write, revert
    registerRewardsRoutes(api);    // daily rewards: shared pool + per-server overrides
    registerUpgradeRoutes(api);    // Minecraft version upgrade: start and progress
    registerPruneRoutes(api);      // chunk pruning: scan, map, delete
    registerModRoutes(api);        // mods: installed list, mutations, Modrinth browse
    registerAnalyticsRoutes(api);  // uptime, activity, command usage: bot history
    registerPlayerRoutes(api);     // player audit: searchable list, per-player detail
  });

  // ── Guild-manager API ── any logged-in Discord user; each route checks
  // canManageGuild for the specific guild it touches. These never expose
  // the Minecraft server, other guilds, or global settings.
  app.register(async (api) => {
    // onRequest for the same fail-closed reason as the sysadmin scope above.
    api.addHook("onRequest", requireSession);
    registerSetupRoutes(api);       // channels/roles + the caller's guilds
    registerGuildConfigRoutes(api); // read/write one guild's config block
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

  assertDevAuthBypassSafe(host);

  const app = buildServer();
  await app.listen({ port, host });
  log.info("web", `Dashboard listening on http://${host}:${port}`);
  if (!process.env.WEBUI_METRICS_TOKEN && !["127.0.0.1", "localhost", "::1"].includes(host)) {
    // /metrics names every server and its player counts. Open is the
    // documented default for loopback-only setups; on a wider bind it
    // should be a choice someone made, not an accident.
    log.warn(
      "web",
      "/metrics is readable without a token on a non-loopback address. " +
        "Set WEBUI_METRICS_TOKEN, or make sure only your reverse proxy can reach this port.",
    );
  }
  return app;
}
