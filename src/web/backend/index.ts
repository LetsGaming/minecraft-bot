/**
 * Dashboard entry point — an independent process from the bot
 * (`npm run start:web`); either can restart without the other. Shares
 * the config file and the data dir (including the SQLite store); the
 * heartbeat file tells this process whether the bot is alive.
 */
import { loadConfig } from "@mcbot/core/config.js";
import { initServers } from "@mcbot/core/utils/server.js";
import { getDb } from "@mcbot/core/db/index.js";
import { startWebServer } from "./server.js";
import { log } from "@mcbot/core/utils/logger.js";

const cfg = loadConfig();
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
getDb();

startWebServer().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  log.error("web", `Failed to start: ${msg}`);
  process.exit(1);
});
