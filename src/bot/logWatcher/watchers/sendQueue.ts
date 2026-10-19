import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";

/**
 * One ordered send queue per Discord channel, so a slow send delays only the
 * channel it is on.
 *
 * Log handlers run one at a time on a server's dispatch queue, so awaiting a
 * Discord round trip inside a handler holds up every other watcher for that
 * server. Handlers queue their sends here and return instead. Ordering still
 * matters within a channel (chat arriving out of order reads as nonsense), so
 * sends are serialised per channel rather than fired in parallel.
 */
const sendQueues = new Map<string, Promise<void>>();
const queueDepth = new Map<string, number>();

/** Depth at which a channel is far enough behind to be worth logging. */
const SEND_QUEUE_WARN_DEPTH = 25;

/**
 * Queue a send for one channel. The returned promise settles once this send
 * has run, and never rejects: errors are logged, because a rejected link
 * would strand every message queued behind it on that channel.
 */
export function enqueueSend(
  channelId: string,
  send: () => Promise<void>,
  describe: string,
  tag: string,
): Promise<void> {
  const depth = (queueDepth.get(channelId) ?? 0) + 1;
  queueDepth.set(channelId, depth);
  if (depth === SEND_QUEUE_WARN_DEPTH) {
    log.warn(
      tag,
      `Channel ${channelId} is ${depth} messages behind: Discord sends are slower than the game`,
    );
  }

  const previous = sendQueues.get(channelId) ?? Promise.resolve();
  const next = previous
    .then(send)
    .catch((err: unknown) => {
      log.error(tag, `${describe}: ${errMsg(err)}`);
    })
    .finally(() => {
      queueDepth.set(channelId, (queueDepth.get(channelId) ?? 1) - 1);
      // Drop the entry once this was the last link, so channels removed from
      // the config do not accumulate resolved promises forever.
      if (sendQueues.get(channelId) === next) {
        sendQueues.delete(channelId);
        queueDepth.delete(channelId);
      }
    });
  sendQueues.set(channelId, next);
  return next;
}

/** Exposed for tests: drain every pending send, including ones queued while draining. */
export async function flushSendQueues(): Promise<void> {
  while (sendQueues.size > 0) {
    await Promise.all([...sendQueues.values()]);
  }
}

/**
 * Run follow-up work outside the caller's dispatch queue. Errors are logged,
 * never thrown, so the caller can drop the returned promise.
 */
export function runDetached(
  tag: string,
  describe: string,
  work: () => Promise<void>,
): Promise<void> {
  return Promise.resolve()
    .then(work)
    .catch((err: unknown) => {
      log.warn(tag, `${describe}: ${errMsg(err)}`);
    });
}
