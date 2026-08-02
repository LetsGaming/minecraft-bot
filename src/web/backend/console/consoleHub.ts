/**
 * DSH-01 — the console's server side: one wrapper stream per Minecraft server,
 * fanned out to every browser watching it.
 *
 * Why a hub and not one upstream per viewer: the wrapper caps concurrent
 * `/logs/stream` clients per instance (MC_SSE_MAX_CLIENTS, default 50), and the
 * bot's own RemoteLogWatcher already holds one of them. If every open browser
 * tab opened its own upstream, a handful of admins with the console open would
 * exhaust the cap and start starving the chat bridge — the dashboard would take
 * the bot down by being used. From the wrapper's side this process is one
 * client no matter how many people are looking.
 *
 * The other reason is the API key. It authenticates the stream and must never
 * reach a browser, so the connection terminates here and the dashboard relays.
 * That relay is the whole feature: a viewer's EventSource talks to us with a
 * session cookie, we talk to the wrapper with the key.
 *
 * Lifetime: the upstream opens on the first subscriber and closes when the last
 * one leaves, so an idle dashboard holds no wrapper connections at all.
 */
import type { ServerConfig } from "@mcbot/core/types/index.js";
import { openLogStream, tailLog } from "@mcbot/core/utils/server/serverAccess.js";
import type { SseLineStream } from "@mcbot/core/utils/sseLineStream.js";
import { log } from "@mcbot/core/utils/logger.js";

/** What a subscriber receives. Mirrors the frames written to the browser. */
export type ConsoleEvent =
  | { type: "line"; line: string }
  | { type: "state"; connected: boolean; detail?: string };

export type ConsoleSubscriber = (event: ConsoleEvent) => void;

/**
 * How many recent lines a viewer gets on connect.
 *
 * Filled two ways, and the first one is the one that matters:
 *
 *   On the FIRST viewer the hub fetches the tail over HTTP, because the SSE
 *   stream only carries lines written after it connects. Without that, opening
 *   the console on a quiet server shows an empty box until something happens —
 *   which reads as "broken", not "idle". The original version only seeded this
 *   from lines the hub had already seen, so it fixed the problem for the
 *   second viewer and left it in place for the first.
 *
 *   After that, live lines append here so late joiners get context too.
 *
 * Small on purpose: a hint about what just happened, not a log viewer.
 */
const BACKLOG_LINES = 100;

/** Cap on the priming fetch, so a slow wrapper cannot hold the stream shut. */
const PRIME_TIMEOUT_MS = 8_000;

interface Channel {
  stream: SseLineStream;
  subscribers: Set<ConsoleSubscriber>;
  backlog: string[];
  connected: boolean;
}

const channels = new Map<string, Channel>();

function createChannel(cfg: ServerConfig): Channel {
  const channel: Channel = {
    subscribers: new Set(),
    backlog: [],
    connected: false,
    stream: undefined as unknown as SseLineStream, // assigned below
  };

  channel.stream = openLogStream(cfg, {
    onLine: (line) => {
      channel.backlog.push(line);
      if (channel.backlog.length > BACKLOG_LINES) channel.backlog.shift();
      emit(channel, { type: "line", line });
    },
    onConnect: () => {
      channel.connected = true;
      emit(channel, { type: "state", connected: true });
    },
    onDisconnect: (reason) => {
      channel.connected = false;
      // The reason is ours, not the viewer's: it can carry a wrapper URL or an
      // upstream status. Viewers get the fact, the operator gets the detail.
      log.warn(cfg.id, `Console upstream dropped: ${reason}`);
      emit(channel, {
        type: "state",
        connected: false,
        detail: "Reconnecting to the server…",
      });
    },
  });

  void primeAndStart(channel, cfg);
  return channel;
}

/**
 * Seed the backlog from the log tail, then open the live stream.
 *
 * Sequenced rather than parallel so the lines arrive in the order they were
 * written: priming after the stream is already delivering would interleave old
 * lines into the middle of new ones. The wait is one HTTP round trip.
 *
 * A failure here is not fatal. If the tail cannot be fetched the console just
 * starts empty, which is the old behaviour — far better than never opening the
 * live stream at all.
 */
async function primeAndStart(channel: Channel, cfg: ServerConfig): Promise<void> {
  try {
    const text = await Promise.race([
      tailLog(cfg, BACKLOG_LINES),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("prime timed out")), PRIME_TIMEOUT_MS),
      ),
    ]);
    const lines = text.split("\n").filter((l) => l.length > 0);
    channel.backlog = lines.slice(-BACKLOG_LINES);
    // Emitted as well as stored: the first viewer subscribed before this
    // resolved, so replaying the backlog at subscribe time missed them.
    for (const line of channel.backlog) emit(channel, { type: "line", line });
  } catch (err) {
    log.warn(cfg.id, `Console backlog unavailable: ${String(err)}`);
  } finally {
    channel.stream.start();
  }
}

/**
 * The only way an event reaches a subscriber.
 *
 * Every delivery is guarded, including the backlog replay in subscribe(). A
 * subscriber here is a write to an HTTP response, and a browser that closed
 * between the route opening the stream and the replay finishing makes that
 * write throw. Unguarded, that exception would unwind out of subscribe() into
 * the route handler and become a 500 on a response whose headers were already
 * sent. The route's close handler unsubscribes it a moment later either way.
 */
function deliver(subscriber: ConsoleSubscriber, event: ConsoleEvent): void {
  try {
    subscriber(event);
  } catch {
    /* a dead response — it will be unsubscribed on close */
  }
}

/** Deliver to every subscriber; one bad subscriber must not stop the others. */
function emit(channel: Channel, event: ConsoleEvent): void {
  for (const subscriber of channel.subscribers) {
    deliver(subscriber, event);
  }
}

/**
 * Attach a viewer to a server's console.
 *
 * Returns the unsubscribe function; callers MUST call it when the client
 * disconnects, or the upstream never closes.
 */
export function subscribe(
  cfg: ServerConfig,
  subscriber: ConsoleSubscriber,
): () => void {
  let channel = channels.get(cfg.id);
  if (!channel) {
    channel = createChannel(cfg);
    channels.set(cfg.id, channel);
  }
  channel.subscribers.add(subscriber);

  // Note: the stream is NOT started here. primeAndStart owns that, so the
  // backlog is in before live lines begin — starting it per subscriber would
  // race the priming fetch and interleave old lines into new ones.

  // Replay before reporting state, so the viewer sees context first and then
  // learns whether the feed is live.
  for (const line of channel.backlog) deliver(subscriber, { type: "line", line });
  deliver(subscriber, {
    type: "state",
    connected: channel.connected,
    ...(channel.connected ? {} : { detail: "Connecting to the server…" }),
  });

  const active = channel;
  return () => {
    active.subscribers.delete(subscriber);
    if (active.subscribers.size === 0) {
      active.stream.stop();
      channels.delete(cfg.id);
      log.info(cfg.id, "Console upstream closed (no viewers left)");
    }
  };
}

/** Viewer count per server. Exposed for tests and the metrics endpoint. */
export function viewerCount(serverId: string): number {
  return channels.get(serverId)?.subscribers.size ?? 0;
}

/** Close every upstream. For graceful shutdown and test isolation. */
export function closeAllConsoles(): void {
  for (const [id, channel] of channels) {
    channel.stream.stop();
    channels.delete(id);
  }
}
