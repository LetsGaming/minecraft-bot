/**
 * A long-lived Server-Sent Events reader: connect, decode, reconnect, repeat.
 *
 * Extracted from RemoteLogWatcher when the dashboard needed the same thing.
 * The watcher held the only working SSE client in the repo, but it lived in
 * `src/bot/` and carried a discord.js `Client`, and the ESLint boundary stops
 * `web` importing `bot` — so the dashboard's options were to duplicate the
 * connect/backoff loop or to move it here. A second copy of reconnect logic is
 * exactly the kind of drift 5.0.0 spent a major version removing.
 *
 * Shaped after RconClient: a protocol client with no knowledge of the game,
 * Discord, or what the payloads mean. It hands out raw `data:` strings and
 * connection-state changes; deciding what a payload *is* belongs to the caller
 * (see openLogStream in serverAccess.ts, which owns the wrapper's `{ line }`
 * contract). That split is what makes this testable without a network.
 *
 * What it deliberately does NOT do: buffer, queue, or apply backpressure. The
 * bot needs an ordered async queue because its handlers make Discord
 * round-trips; the dashboard writes straight to open responses and needs
 * nothing. Putting the queue here would impose the bot's problem on every
 * consumer, so it stays with the consumer that has it.
 */
import { log } from "./logger.js";

const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 60_000;
/** Budget for the initial handshake only, not for the stream's lifetime. */
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * Incremental SSE frame decoder.
 *
 * Separate from the stream so the parsing rules can be tested against
 * hand-written chunk boundaries, which is where this kind of code actually
 * breaks: a frame split mid-`data:` line, a multi-line frame, a keep-alive
 * comment. Feed it whatever arrives and it returns the payloads that are
 * complete, holding the remainder.
 */
export class SseFrameDecoder {
  private _buf = "";

  /** Push a decoded text chunk; get back every complete `data:` payload. */
  push(chunk: string): string[] {
    this._buf += chunk;
    // Frames are delimited by a blank line. The tail after the last delimiter
    // is a partial frame and stays buffered.
    const frames = this._buf.split("\n\n");
    this._buf = frames.pop() ?? "";

    const out: string[] = [];
    for (const frame of frames) {
      for (const rawLine of frame.split("\n")) {
        // `:` alone is a keep-alive comment; every other field (event:, id:,
        // retry:) is ignored because the wrapper does not send them.
        if (!rawLine.startsWith("data:")) continue;
        const payload = rawLine.slice(5).trim();
        if (payload) out.push(payload);
      }
    }
    return out;
  }

  /** Drop any partial frame. Call when a connection ends. */
  reset(): void {
    this._buf = "";
  }
}

export interface SseLineStreamOptions {
  /** Absolute URL of the SSE endpoint. */
  url: string;
  /** Sent on every connect attempt, including reconnects. */
  headers?: Record<string, string>;
  /** Tag for log lines: the server id, usually. */
  scope: string;
  /** One complete `data:` payload. Must not throw. */
  onData: (payload: string) => void;
  /** The stream is up. Fires again after every successful reconnect. */
  onConnect?: () => void;
  /** The stream went down. A reconnect is already scheduled. */
  onDisconnect?: (reason: string) => void;
}

/** Where the stream currently is, for callers that surface it. */
export type SseStreamState = "connecting" | "connected" | "reconnecting" | "stopped";

export class SseLineStream {
  private readonly _opts: SseLineStreamOptions;
  private readonly _decoder = new SseFrameDecoder();
  private _state: SseStreamState = "stopped";
  private _stopped = true;
  private _reconnectDelay = RECONNECT_BASE_MS;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _abort: AbortController | null = null;

  constructor(options: SseLineStreamOptions) {
    this._opts = options;
  }

  get state(): SseStreamState {
    return this._state;
  }

  get connected(): boolean {
    return this._state === "connected";
  }

  start(): void {
    if (!this._stopped) return; // already running; start() is idempotent
    this._stopped = false;
    this._state = "connecting";
    void this._read();
  }

  stop(): void {
    this._stopped = true;
    this._state = "stopped";
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._abort) {
      this._abort.abort();
      this._abort = null;
    }
    this._decoder.reset();
  }

  private async _read(): Promise<void> {
    if (this._stopped) return;

    // A fresh controller per attempt, captured locally: a timer left over from
    // a previous attempt must not be able to abort the current connection.
    const controller = new AbortController();
    this._abort = controller;
    const handshake = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(this._opts.url, {
        headers: this._opts.headers ?? {},
        signal: controller.signal,
      });
    } catch (err) {
      this._scheduleReconnect(`connect failed: ${String(err)}`);
      return;
    } finally {
      clearTimeout(handshake);
    }

    if (!res.ok || !res.body) {
      this._scheduleReconnect(`bad response: ${res.status}`);
      return;
    }

    // stop() may have been called while the handshake was in flight. It aborts
    // the controller, which usually rejects the fetch above — but not if the
    // response had already resolved, and in that window we would otherwise
    // announce a connection the caller has just cancelled and then read from
    // it. Re-check after every await rather than trusting the abort.
    if (this._stopped) {
      void res.body.cancel();
      return;
    }

    this._reconnectDelay = RECONNECT_BASE_MS; // reset on a successful connect
    this._state = "connected";
    this._decoder.reset();
    log.info(this._opts.scope, `SSE stream connected: ${this._opts.url}`);
    this._opts.onConnect?.();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    try {
      for (;;) {
        if (this._stopped) {
          void reader.cancel();
          return;
        }
        const { done, value } = await reader.read();
        if (done) break;
        for (const payload of this._decoder.push(
          decoder.decode(value, { stream: true }),
        )) {
          this._opts.onData(payload);
        }
      }
    } catch (err) {
      if (!this._stopped) this._scheduleReconnect(`stream error: ${String(err)}`);
      return;
    }

    if (!this._stopped) this._scheduleReconnect("stream ended");
  }

  private _scheduleReconnect(reason: string): void {
    if (this._stopped) return;
    this._state = "reconnecting";
    this._decoder.reset();
    log.warn(
      this._opts.scope,
      `SSE stream disconnected (${reason}), reconnecting in ${this._reconnectDelay / 1000}s`,
    );
    this._opts.onDisconnect?.(reason);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      void this._read();
    }, this._reconnectDelay);
    this._reconnectDelay = Math.min(this._reconnectDelay * 2, RECONNECT_MAX_MS);
  }
}
