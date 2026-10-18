/**
 * Dashboard entry point — an independent process from the bot
 * (`npm run start:web`); either can restart without the other. Shares
 * the config file and the data dir (including the SQLite store); the
 * heartbeat file tells this process whether the bot is alive.
 */
import { MS } from "@mcbot/schema";
import { loadConfig } from "@mcbot/core/config.js";
import { initServers } from "@mcbot/core/utils/server/server.js";
import type { FastifyInstance } from "fastify";
import { getDb, closeDb } from "@mcbot/core/db/index.js";
import { startWebServer } from "./server.js";
import { startLiveConfig } from "./config/liveConfig.js";
import { closeAllConsoles } from "./console/consoleHub.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";

// Last-resort diagnostics: in a container an uncaught error at startup
// becomes exit 1 and Docker restarts in a loop. Make sure the reason is
// always on stdout (where `docker compose logs` can see it) rather than
// a bare, easily-missed stack.
process.on("uncaughtException", (err) => {
  log.error("web", `Uncaught exception: ${err.stack ?? err.message}`);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  log.error("web", `Unhandled rejection: ${msg}`);
  process.exit(1);
});

let cfg;
try {
  cfg = loadConfig();
} catch (err) {
  log.error("web", `Failed to load config.json: ${errMsg(err)}`);
  process.exit(1);
}

if (cfg.webui?.enabled !== true) {
  log.error(
    "web",
    'Dashboard is disabled — set "webui": { "enabled": true } in config.json',
  );
  process.exit(1);
}

// The dashboard runs its own ServerInstance registry (RCON, status reads,
// log tail) precisely so it works with the bot down — server operations
// and config edits are most valuable when the bot is broken. Previously
// this call was missing (4.0 finding F1): the registry stayed empty and
// the dashboard reported every server offline.
initServers(cfg.servers);

// Open the shared SQLite store now: migrations + legacy-JSON import run
// here idempotently, so the dashboard has a current schema even when it
// is the only process running.
//
// This is the single most common dashboard boot failure in containers:
// the native better-sqlite3 binding can fail to load on Alpine/musl,
// and getDb() throws synchronously → the container exits 1 and Docker
// restarts it in a loop. Catch it here so the log line is actionable
// (the fix is MCBOT_SQLITE_DRIVER=node, which compose sets by default
// for this service) instead of a bare stack trace on repeat.
try {
  getDb();
} catch (err) {
  log.error(
    "web",
    `Failed to open the SQLite store: ${errMsg(err)}\n` +
      "  In Docker, set MCBOT_SQLITE_DRIVER=node on the web service to use " +
      "the built-in driver (no native build). The default docker-compose.yml " +
      "already does this — rebuild with `docker compose up -d --build web`.",
  );
  process.exit(1);
}

startLiveConfig();

let server: FastifyInstance | null = null;
startWebServer()
  .then((app) => {
    server = app;
  })
  .catch((err: unknown) => {
    log.error("web", `Failed to start: ${errMsg(err)}`);
    process.exit(1);
  });

/**
 * AUD-027: stop cleanly on `docker stop` / Ctrl+C. Without a handler, node
 * as PID 1 ignores SIGTERM, Docker waits out its timeout and SIGKILLs, and
 * the console upstreams, open responses and the SQLite handle are never
 * closed. A shutdown that hangs (a stuck stream) still ends after a grace
 * period.
 */
const SHUTDOWN_GRACE_MS = 8 * MS.second;
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("web", `Received ${signal} — closing the dashboard`);
  setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref();
  closeAllConsoles();
  try {
    await server?.close();
  } catch (err) {
    log.warn("web", `Closing the HTTP server failed: ${errMsg(err)}`);
  }
  closeDb();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
