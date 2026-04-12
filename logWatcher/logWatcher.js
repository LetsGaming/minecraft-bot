import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import readline from "readline";
import { log } from "../utils/logger.js";

const POLL_INTERVAL_MS = 1000;

/**
 * Per-server log watcher instance.
 * Uses fs.watch with polling fallback for reliability.
 */
export class LogWatcher {
  constructor(serverInstance) {
    this.server = serverInstance;
    this.logFile = path.join(
      serverInstance.config.serverDir,
      "logs",
      "latest.log",
    );
    this.logsDir = path.dirname(this.logFile);
    this.lastSize = 0;
    this.reading = false;
    this.watchers = [];
    this.client = null;
    this._pollTimer = null;
    this._fsWatcher = null;
  }

  /** Register a handler: { regex, handler } */
  register(regex, handler) {
    this.watchers.push({ regex, handler });
  }

  /** Start watching */
  async start(client) {
    this.client = client;

    try {
      const stats = await fs.stat(this.logFile);
      this.lastSize = stats.size;
    } catch {
      this.lastSize = 0;
    }

    // Primary: fs.watch (fast, event-driven)
    try {
      this._fsWatcher = fsSync.watch(this.logsDir, async (event, filename) => {
        if (filename !== "latest.log") return;
        await this._processChanges(event);
      });
      this._fsWatcher.on("error", () => {
        log.warn(this.server.id, "fs.watch failed, using polling only");
        this._fsWatcher = null;
      });
    } catch {
      log.warn(this.server.id, "fs.watch not available, using polling");
    }

    // Fallback: polling (catches anything fs.watch misses)
    this._pollTimer = setInterval(
      () => this._processChanges("change"),
      POLL_INTERVAL_MS,
    );

    log.info(this.server.id, `Watching ${this.logFile}`);
  }

  stop() {
    if (this._fsWatcher) {
      this._fsWatcher.close();
      this._fsWatcher = null;
    }
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async _processChanges(event) {
    if (this.reading) return;
    this.reading = true;
    try {
      if (event === "rename") {
        try {
          await fs.access(this.logFile);
          this.lastSize = 0;
        } catch {
          return;
        }
      }
      await this._readNewLines();
    } finally {
      this.reading = false;
    }
  }

  async _readNewLines() {
    try {
      const stats = await fs.stat(this.logFile);
      if (stats.size < this.lastSize) this.lastSize = 0;
      if (stats.size === this.lastSize) return;

      const stream = fsSync.createReadStream(this.logFile, {
        start: this.lastSize,
        end: stats.size - 1,
      });
      const rl = readline.createInterface({ input: stream });

      for await (const line of rl) {
        for (const { regex, handler } of this.watchers) {
          const match = regex.exec(line);
          if (match) {
            try {
              await handler(match, this.client, this.server);
            } catch (err) {
              log.error(this.server.id, `Log handler error: ${err.message}`);
            }
          }
        }
      }
      this.lastSize = stats.size;
    } catch (err) {
      if (err.code === "ENOENT") {
        this.lastSize = 0;
      } else {
        log.error(this.server.id, `Log read error: ${err.message}`);
      }
    }
  }
}

// ── Global registry for backward compat ──
const _globalWatchers = [];
export function registerLogCommand(regex, handler) {
  _globalWatchers.push({ regex, handler });
}
export function getGlobalWatchers() {
  return _globalWatchers;
}
