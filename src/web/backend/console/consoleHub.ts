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
import { openLogStream } from "@mcbot/core/utils/server/serverAccess.js";
import type { SseLineStream } from "@mcbot/core/utils/sseLineStream.js";
import { log } from "@mcbot/core/utils/logger.js";

/** What a subscriber receives. Mirrors the frames written to the browser. */
export type ConsoleEvent =
  | { type: "line"; line: string }
  | { type: "state"; connected: boolean; detail?: string };

export type ConsoleSubscriber = (event: ConsoleEvent) => void;

/**
 * How many recent lines a new viewer gets on connect.
 *
 * Without this, opening the console shows an empty box until the server next
 * says something, which on a quiet night reads as broken. Small on purpose:
 * the backlog is a hint about what just happened, not a log viewer. Anyone
 * wanting history has the log tail endpoint.
 */
const BACKLOG_LINES = 200;

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

  return channel;
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

  // start() is idempotent, so calling it per subscriber is safe and saves a
  // separate "is it running" flag here.
  channel.stream.start();

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
