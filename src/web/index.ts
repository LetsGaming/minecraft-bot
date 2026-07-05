/**
 * Dashboard entry point — an independent process from the bot
 * (`npm run start:web`); either can restart without the other. Shares
 * the config file and the data dir; the heartbeat file tells this
 * process whether the bot is alive.
 */
import { loadConfig } from "../common/config.js";
import { startWebServer } from "./backend/server.js";
import { log } from "../common/utils/logger.js";

const cfg = loadConfig();
if (cfg.webui?.enabled !== true) {
  log.error(
    "web",
    'Dashboard is disabled — set "webui": { "enabled": true } in config.json',
  );
  process.exit(1);
}

startWebServer().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  log.error("web", `Failed to start: ${msg}`);
  process.exit(1);
});
