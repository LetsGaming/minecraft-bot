/**
 * Dashboard backend — one Fastify instance, built by buildServer() so
 * route tests can use fastify.inject without binding a port.
 *
 * Route map (docs/dev/webui-integration.md):
 *   /auth/login|callback|logout    Discord OAuth2 (auth.ts)
 *   /api/me                        session probe
 *   /api/status                    phase 1: per-server live status
 *   /api/uptime/:serverId          phase 1: uptime stats + sparkline
 *   /api/audit                     phase 1: admin audit log
 *   /api/config                    phase 1: redacted raw config
 *   /api/config/schema             phase 2: config.schema.json
 *   PUT /api/config                phase 2: validate + write (whole file)
 *   POST /api/servers/:id/:action  phase 3: start/stop/restart/backup
 *   GET  /api/servers/:id/log      phase 3: log tail
 *   POST /api/servers/:id/prune-stats  phase 3 (?dryRun=1 supported)
 *   /healthz, /metrics             unauthenticated probes
 *   everything else                static Vue frontend (dist/web/frontend)
 *
 * The web process may import src/common only (ESLint boundary): status
 * comes from the same ServerInstance layer the bot uses, config writes
 * go through configService.writeConfig — never through the bot.
 */
import Fastify, { type FastifyInstance } from "fastify";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadConfig, getServerIds } from "../../common/config.js";
import {
  readRawConfig,
  validateCandidate,
  writeConfig,
} from "../../common/utils/configService.js";
import {
  getServerInstance,
  getAllInstances,
} from "../../common/utils/server.js";
import {
  runScript,
  tailLog,
  listStatsUuids,
  deleteStatsFile,
  readWhitelist,
  readUserCache,
} from "../../common/utils/serverAccess.js";
import { getUptimeStats } from "../../common/utils/uptimeTracker.js";
import {
  loadAdminAudit,
  recordAdminAction,
} from "../../common/utils/adminAudit.js";
import { getHostResources } from "../../common/utils/hostResources.js";
import {
  readRuntimeHeartbeat,
  heartbeatIsFresh,
} from "../../common/utils/runtimeHeartbeat.js";
import { loadPlayerCountStore } from "../../common/utils/playerCountHistory.js";
import { log } from "../../common/utils/logger.js";
import {
  buildAuthorizeUrl,
  verifyState,
  exchangeCode,
  webAdminIds,
  sessionFromRequest,
  setSessionCookie,
  clearSessionCookie,
  requireAdminSession,
} from "./auth.js";
import { toSafeConfig, mergeSecretPlaceholders } from "./safeConfig.js";
import type { RawBotConfig } from "../../common/types/index.js";

const SCRIPT_ACTIONS = new Set(["start", "stop", "restart", "backup"]);

// ── Live status (phase 1) ─────────────────────────────────────────────────

interface ServerStatus {
  id: string;
  online: boolean;
  players: { online: number; max: number; names: string[] };
  tps: number | null;
  host: {
    process: { rssBytes: number; cpuPercent: number } | null;
    disks: Array<{ path: string; usedPercent: number }>;
  } | null;
}

async function collectStatus(serverId: string): Promise<ServerStatus> {
  const server = getServerInstance(serverId);
  if (!server) throw new Error(`unknown server ${serverId}`);

  const base: ServerStatus = {
    id: serverId,
    online: false,
    players: { online: 0, max: 0, names: [] },
    tps: null,
    host: null,
  };

  try {
    if (!(await server.isRunning())) return base;
    base.online = true;
    const list = await server.getList();
    base.players = {
      online: parseInt(String(list.playerCount), 10) || 0,
      max: parseInt(String(list.maxPlayers), 10) || 0,
      names: list.players ?? [],
    };
  } catch {
    return base;
  }

  try {
    const tps = await server.getTps();
    base.tps = tps?.tps1m ?? null;
  } catch {
    /* tps unavailable (vanilla) */
  }
  try {
    const host = await getHostResources(server);
    if (host) {
      base.host = {
        process: host.process
          ? { rssBytes: host.process.rssBytes, cpuPercent: host.process.cpuPercent }
          : null,
        disks: host.disks.map((d) => ({
          path: d.path,
          usedPercent: d.usedPercent,
        })),
      };
    }
  } catch {
    /* host metrics stay null */
  }
  return base;
}

// ── Static frontend ───────────────────────────────────────────────────────

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".map": "application/json",
  ".woff2": "font/woff2",
};

function frontendDir(): string {
  // dist/web/backend/server.js → dist/web/frontend
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "frontend");
}

// ── Server ────────────────────────────────────────────────────────────────

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy: true });

  // ── Auth ──
  app.get("/auth/login", async (_req, reply) => {
    const { url } = buildAuthorizeUrl();
    return reply.redirect(url);
  });

  app.get("/auth/callback", async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !verifyState(state)) {
      return reply.code(400).send("Invalid OAuth state — try logging in again.");
    }
    const user = await exchangeCode(code);
    if (!user) return reply.code(502).send("Discord OAuth exchange failed.");
    if (!webAdminIds().has(user.id)) {
      return reply
        .code(403)
        .send(
          "This Discord account is not in any adminUsers list. " +
            "Role-based admin entries work in Discord only — the dashboard needs your user ID listed.",
        );
    }
    setSessionCookie(reply, user);
    return reply.redirect("/");
  });

  app.post("/auth/logout", async (_req, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/api/me", async (req, reply) => {
    const session = sessionFromRequest(req);
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    return { uid: session.uid, tag: session.tag };
  });

  // ── Authenticated API ──
  app.register(async (api) => {
    api.addHook("preHandler", requireAdminSession);

    // Phase 1 — read-only
    api.get("/api/status", async () => {
      const beat = await readRuntimeHeartbeat();
      const servers = await Promise.all(
        getServerIds().map((id) =>
          collectStatus(id).catch(
            () =>
              ({
                id,
                online: false,
                players: { online: 0, max: 0, names: [] },
                tps: null,
                host: null,
              }) satisfies ServerStatus,
          ),
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

    api.get("/api/config", async () => toSafeConfig(readRawConfig()));

    // Phase 2 — schema-driven editing
    api.get("/api/config/schema", async (_req, reply) => {
      const schemaPath = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "..",
        "..",
        "config.schema.json",
      );
      try {
        const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
        return schema;
      } catch {
        return reply.code(404).send({ error: "schema not generated" });
      }
    });

    api.put("/api/config", async (req, reply) => {
      const submitted = req.body as RawBotConfig;
      if (typeof submitted !== "object" || submitted === null) {
        return reply.code(400).send({ errors: ["Body must be a config object"] });
      }
      const current = readRawConfig();
      const merged = mergeSecretPlaceholders(submitted, current);

      const result = validateCandidate(merged);
      if (!result.valid) {
        return reply.code(422).send({ errors: result.errors });
      }

      await writeConfig(merged);
      const session = sessionFromRequest(req)!;
      await recordAdminAction({
        action: "config write (dashboard)",
        by: session.tag,
        byId: session.uid,
      });
      return { ok: true, warnings: result.warnings };
    });

    // Phase 3 — operations
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
        const msg = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: msg });
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
        const msg = err instanceof Error ? err.message : String(err);
        return reply.code(500).send({ error: msg });
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
  });

  // ── Unauthenticated probes ──
  app.get("/healthz", async () => {
    const beat = await readRuntimeHeartbeat();
    return { web: "ok", bot: heartbeatIsFresh(beat) ? "ok" : "stale" };
  });

  app.get("/metrics", async (_req, reply) => {
    const lines: string[] = [];
    const push = (name: string, help: string, type: string): void => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    };

    const beat = await readRuntimeHeartbeat();
    push("mcbot_bot_up", "1 when the bot heartbeat is fresh", "gauge");
    lines.push(`mcbot_bot_up ${heartbeatIsFresh(beat) ? 1 : 0}`);

    push("mcbot_server_online", "1 when the server responds", "gauge");
    push("mcbot_players_online", "Players currently online", "gauge");
    push("mcbot_server_tps", "1-minute TPS (absent when unsupported)", "gauge");
    for (const inst of getAllInstances()) {
      const status = await collectStatus(inst.id).catch(() => null);
      const label = `{server="${inst.id}"}`;
      lines.push(`mcbot_server_online${label} ${status?.online ? 1 : 0}`);
      lines.push(`mcbot_players_online${label} ${status?.players.online ?? 0}`);
      if (status?.tps !== null && status?.tps !== undefined) {
        lines.push(`mcbot_server_tps${label} ${status.tps}`);
      }
    }

    return reply
      .header("content-type", "text/plain; version=0.0.4")
      .send(lines.join("\n") + "\n");
  });

  // ── Static frontend (everything unmatched) ──
  app.setNotFoundHandler(async (req, reply) => {
    if (req.method !== "GET" || req.url.startsWith("/api")) {
      return reply.code(404).send({ error: "not found" });
    }
    const dir = frontendDir();
    // Path traversal guard: resolve and require the dir prefix.
    const urlPath = req.url.split("?")[0] ?? "/";
    const rel = urlPath === "/" ? "index.html" : urlPath.slice(1);
    const file = path.resolve(dir, rel);
    if (!file.startsWith(dir + path.sep) && file !== path.resolve(dir, "index.html")) {
      return reply.code(404).send({ error: "not found" });
    }
    const target = fs.existsSync(file) && fs.statSync(file).isFile()
      ? file
      : path.resolve(dir, "index.html"); // SPA fallback
    if (!fs.existsSync(target)) {
      return reply
        .code(503)
        .send("Frontend not built — run: npm run build:web");
    }
    const type = CONTENT_TYPES[path.extname(target)] ?? "application/octet-stream";
    return reply.header("content-type", type).send(fs.readFileSync(target));
  });

  return app;
}

export async function startWebServer(): Promise<FastifyInstance> {
  const cfg = loadConfig();
  const port = cfg.webui?.port ?? 8130;
  const host = cfg.webui?.host ?? "127.0.0.1";

  const app = buildServer();
  await app.listen({ port, host });
  log.info("web", `Dashboard listening on http://${host}:${port}`);
  return app;
}
