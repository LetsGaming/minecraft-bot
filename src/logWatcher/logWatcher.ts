import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import readline from 'readline';
import { log } from '../utils/logger.js';
import type { Client } from 'discord.js';
import type { ServerInstance } from '../utils/server.js';
import type { LogHandler, LogWatcherEntry } from '../types/index.js';

const POLL_INTERVAL_MS = 1000;

/**
 * Per-server log watcher instance.
 * Uses fs.watch with polling fallback for reliability.
 */
export class LogWatcher {
  readonly server: ServerInstance;
  private readonly logFile: string;
  private readonly logsDir: string;
  private lastSize = 0;
  private reading = false;
  private readonly watchers: LogWatcherEntry[] = [];
  private client: Client | null = null;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _fsWatcher: fsSync.FSWatcher | null = null;

  constructor(serverInstance: ServerInstance) {
    this.server = serverInstance;
    this.logFile = path.join(
      serverInstance.config.serverDir,
      'logs',
      'latest.log',
    );
    this.logsDir = path.dirname(this.logFile);
  }

  /** Register a handler: { regex, handler } */
  register(regex: RegExp, handler: LogHandler): void {
    this.watchers.push({ regex, handler });
  }

  /** Start watching */
  async start(client: Client): Promise<void> {
    this.client = client;

    try {
      const stats = await fs.stat(this.logFile);
      this.lastSize = stats.size;
    } catch {
      this.lastSize = 0;
    }

    // Primary: fs.watch (fast, event-driven)
    try {
      this._fsWatcher = fsSync.watch(this.logsDir, async (_event, filename) => {
        if (filename !== 'latest.log') return;
        await this._processChanges(_event ?? 'change');
      });
      this._fsWatcher.on('error', () => {
        log.warn(this.server.id, 'fs.watch failed, using polling only');
        this._fsWatcher = null;
      });
    } catch {
      log.warn(this.server.id, 'fs.watch not available, using polling');
    }

    // Fallback: polling (catches anything fs.watch misses)
    this._pollTimer = setInterval(
      () => this._processChanges('change'),
      POLL_INTERVAL_MS,
    );

    log.info(this.server.id, `Watching ${this.logFile}`);
  }

  stop(): void {
    if (this._fsWatcher) {
      this._fsWatcher.close();
      this._fsWatcher = null;
    }
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  private async _processChanges(event: string): Promise<void> {
    if (this.reading) return;
    this.reading = true;
    try {
      if (event === 'rename') {
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

  private async _readNewLines(): Promise<void> {
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
              await handler(match, this.client!, this.server);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              log.error(this.server.id, `Log handler error: ${msg}`);
            }
          }
        }
      }
      this.lastSize = stats.size;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.lastSize = 0;
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(this.server.id, `Log read error: ${msg}`);
      }
    }
  }
}

// ── Global registry for backward compat ──

const _globalWatchers: LogWatcherEntry[] = [];

export function registerLogCommand(regex: RegExp, handler: LogHandler): void {
  _globalWatchers.push({ regex, handler });
}

export function getGlobalWatchers(): LogWatcherEntry[] {
  return _globalWatchers;
}
