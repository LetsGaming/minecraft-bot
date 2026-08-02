/**
 * RemoteLogWatcher
 *
 * Dispatches the wrapper's log lines through the same registered handler list
 * that the local LogWatcher uses. The interface is intentionally identical so
 * initMinecraftCommands can treat both the same way.
 *
 * The connect/decode/reconnect half moved to `@mcbot/core/utils/sseLineStream`
 * when the dashboard needed the same transport, and it is reached here through
 * `openLogStream`, which owns the wrapper's payload contract. What stayed is
 * everything Discord-shaped: the handler registry, the client, and the ordered
 * dispatch queue below (which exists because *these* handlers make Discord
 * round-trips — the dashboard's consumer has no such problem and gets no such
 * queue).
 */

import { log } from "@mcbot/core/utils/logger.js";
import { openLogStream } from "@mcbot/core/utils/server/serverAccess.js";
import type { SseLineStream } from "@mcbot/core/utils/sseLineStream.js";
import type { Client } from "discord.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import type { LogHandler, LogWatcherEntry } from "@mcbot/core/types/index.js";
import { errMsg } from "@mcbot/core/utils/error.js";

/** Depth at which the handler queue is falling behind enough to say so. */
const QUEUE_WARN_DEPTH = 50;

export class RemoteLogWatcher {
  readonly server: ServerInstance;
  private readonly _watchers: LogWatcherEntry[] = [];
  private _client: Client | null = null;
  private _stream: SseLineStream | null = null;
  /**
   * Serialises handler dispatch without the socket reader waiting on it.
   *
   * The read loop used to `await this._dispatch(line)`, so the SSE socket sat
   * idle for the whole of every handler's Discord round-trip — and handlers
   * run serially, so line N+1 waited for line N's HTTP request to finish. On
   * a chatty server that compounds into seconds of visible lag between
   * someone typing in game and the message appearing in Discord.
   *
   * Handlers still run one at a time and in order (several of them depend on
   * that — join/leave bookkeeping, session tracking). The change is only that
   * the *reader* no longer blocks on the queue, so incoming lines are drained
   * from the socket at network speed and buffered here instead of applying
   * backpressure all the way to the wrapper's fan-out.
   */
  private _queue: Promise<void> = Promise.resolve();
  private _queueDepth = 0;

  constructor(server: ServerInstance) {
    this.server = server;
  }

  register(regex: RegExp, handler: LogHandler): void {
    this._watchers.push({ regex, handler });
  }

  async start(client: Client): Promise<void> {
    this._client = client;
    this._stream ??= openLogStream(this.server.config, {
      onLine: (line) => this._enqueue(line),
    });
    this._stream.start();
  }

  stop(): void {
    this._stream?.stop();
  }

  /**
   * Hand a line to the ordered handler queue and return immediately.
   *
   * The depth counter exists to make a stuck handler visible: without it a
   * queue that stops draining looks exactly like a quiet server. It only
   * warns — dropping lines would lose chat, and slow-but-correct beats fast
   * and lossy for this.
   */
  private _enqueue(line: string): void {
    this._queueDepth++;
    if (this._queueDepth === QUEUE_WARN_DEPTH) {
      log.warn(
        this.server.id,
        `Log handler queue is ${this._queueDepth} lines deep — Discord ` +
          `round-trips are not keeping up with the log`,
      );
    }
    this._queue = this._queue
      .then(() => this._dispatch(line))
      .finally(() => {
        this._queueDepth--;
      });
  }

  private async _dispatch(line: string): Promise<void> {
    for (const { regex, handler } of this._watchers) {
      const match = regex.exec(line);
      if (match) {
        try {
          await handler(match, this._client!, this.server);
        } catch (err) {
          log.error(this.server.id, `Log handler error: ${errMsg(err)}`);
        }
      }
    }
  }
}
