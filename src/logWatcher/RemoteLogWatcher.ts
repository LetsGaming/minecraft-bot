/**
 * RemoteLogWatcher
 *
 * Connects to the API wrapper's SSE log-stream endpoint and dispatches
 * incoming log lines through the same registered handler list that the
 * local LogWatcher uses.  The interface is intentionally identical so
 * initMinecraftCommands can treat both the same way.
 */

import { log } from "../utils/logger.js";
import { logStreamUrl } from "../utils/serverAccess.js";
import type { Client } from "discord.js";
import type { ServerInstance } from "../utils/server.js";
import type { LogHandler, LogWatcherEntry } from "../types/index.js";

const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 60_000;

export class RemoteLogWatcher {
  readonly server: ServerInstance;
  private readonly _watchers: LogWatcherEntry[] = [];
  private _client: Client | null = null;
  private _stopped = false;
  private _reconnectDelay = RECONNECT_BASE_MS;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _abortController: AbortController | null = null;

  constructor(server: ServerInstance) {
    this.server = server;
  }

  register(regex: RegExp, handler: LogHandler): void {
    this._watchers.push({ regex, handler });
  }

  async start(client: Client): Promise<void> {
    this._client = client;
    this._stopped = false;
    this._connect();
  }

  stop(): void {
    this._stopped = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  // ── SSE connection loop ───────────────────────────────────────────────

  private _connect(): void {
    if (this._stopped) return;
    void this._readStream();
  }

  private async _readStream(): Promise<void> {
    const url = logStreamUrl(this.server.config);
    log.info(this.server.id, `Connecting to remote log stream: ${url}`);

    const headers: Record<string, string> = {};
    if (this.server.config.apiKey)
      headers["x-api-key"] = this.server.config.apiKey;

    // Use a separate AbortController for the connection so we can cancel it
    // on stop(), while keeping a short timeout only for the initial handshake.
    // Capture the controller locally so stale timers from previous attempts
    // cannot abort a newly created controller after a reconnect.
    const controller = new AbortController();
    this._abortController = controller;
    const connectTimeout = setTimeout(() => controller.abort(), 10_000);

    let res: Response;
    try {
      res = await fetch(url, { headers, signal: controller.signal });
    } catch (err) {
      this._scheduleReconnect(`connect failed: ${String(err)}`);
      return;
    } finally {
      clearTimeout(connectTimeout);
    }

    if (!res.ok || !res.body) {
      this._scheduleReconnect(`bad response: ${res.status}`);
      return;
    }

    this._reconnectDelay = RECONNECT_BASE_MS; // reset on successful connect
    log.info(this.server.id, "Remote log stream connected");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    try {
      for (;;) {
        if (this._stopped) {
          reader.cancel();
          return;
        }
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });

        // SSE events are delimited by \n\n
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";

        for (const event of events) {
          for (const raw of event.split("\n")) {
            if (!raw.startsWith("data:")) continue;
            const json = raw.slice(5).trim();
            if (!json) continue;
            try {
              const { line } = JSON.parse(json) as { line: string };
              await this._dispatch(line);
            } catch {
              /* malformed — skip */
            }
          }
        }
      }
    } catch (err) {
      if (!this._stopped)
        this._scheduleReconnect(`stream error: ${String(err)}`);
      return;
    }

    if (!this._stopped) this._scheduleReconnect("stream ended");
  }

  private _scheduleReconnect(reason: string): void {
    if (this._stopped) return;
    log.warn(
      this.server.id,
      `Log stream disconnected (${reason}), reconnecting in ${this._reconnectDelay / 1000}s`,
    );
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, this._reconnectDelay);
    this._reconnectDelay = Math.min(this._reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  private async _dispatch(line: string): Promise<void> {
    for (const { regex, handler } of this._watchers) {
      const match = regex.exec(line);
      if (match) {
        try {
          await handler(match, this._client!, this.server);
        } catch (err) {
          log.error(
            this.server.id,
            `Log handler error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }
}
