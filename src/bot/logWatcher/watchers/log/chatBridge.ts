import { type Client, type Webhook } from "discord.js";
import { log } from "@mcbot/core/utils/logger.js";
import { createPlayerEmbed } from "../../../utils/embeds/embedUtils.js";
import { playerAvatarUrl } from "../../../utils/mcHeads.js";
import { EmbedColor } from "../../../utils/embeds/embedColors.js";
import type { ILogWatcher } from "../../logWatcher.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import type { GuildConfig, GuildChatBridgeConfig } from "@mcbot/core/types/index.js";
import { sanitizeForConsole } from "@mcbot/core/utils/sanitize.js";
import {
  createRateLimiter,
  bridgeLimiterSettings,
} from "@mcbot/core/utils/rateLimiter.js";
import {
  resolveGuildConfigs,
  type GuildConfigSource,
} from "../../../utils/guild/guildConfigs.js";

const CHAT_REGEX = /\[.+?\]: <(?:\[AFK\]\s*)?([^>]+)>\s+(.+)/;

// The bridge listens on messageCreate, so the slash-command limiter never
// sees it — it needs its own bucket or any member could flood the game
// console at Discord message speed. Burst of 8, ~0.8 msg/s sustained:
// fine for lively chat, stops floods.
// Capacity/window come from the `limits` config block (defaults 8/10s);
// the limiter shape is fixed at module load — changing limits needs a
// restart, same as the slash limiter.
const bridgeLimiter = createRateLimiter(bridgeLimiterSettings());

/** A bridge after normalization: one channel ↔ exactly one server. */
export interface ResolvedBridge {
  channelId: string;
  serverId: string;
  useWebhook?: boolean;
}

/**
 * Normalize a guild's chatBridge config (single object or array) into
 * unambiguous channel↔server pairs.
 *
 * Deliberately strict: one channel ↔ exactly one server, both directions,
 * so conversations from different servers can never mix in one channel.
 * `server` may only be omitted when it's unambiguous (guild defaultServer,
 * or a single configured server); anything else is a problem — skipped,
 * logged at setup, and rejected by config validation.
 */
export function resolveGuildBridges(
  gcfg: GuildConfig,
  allServerIds: string[],
): { bridges: ResolvedBridge[]; problems: string[] } {
  const raw = gcfg.chatBridge;
  const list: GuildChatBridgeConfig[] = !raw
    ? []
    : Array.isArray(raw)
      ? raw
      : [raw];

  const bridges: ResolvedBridge[] = [];
  const problems: string[] = [];
  const channelBinding = new Map<string, string>();

  for (const bridge of list) {
    if (!bridge?.channelId) continue;

    const serverId =
      bridge.server ??
      gcfg.defaultServer ??
      (allServerIds.length === 1 ? allServerIds[0] : undefined);

    if (!serverId) {
      problems.push(
        `chatBridge channel ${bridge.channelId}: multiple servers are ` +
          `configured but the bridge has no "server" and the guild has no ` +
          `"defaultServer" — set "server" so the channel is bound to ` +
          `exactly one server.`,
      );
      continue;
    }

    const existing = channelBinding.get(bridge.channelId);
    if (existing && existing !== serverId) {
      problems.push(
        `chatBridge channel ${bridge.channelId} is bound to both ` +
          `"${existing}" and "${serverId}" — one channel bridges exactly ` +
          `one server. Use a separate channel per server.`,
      );
      continue;
    }
    if (!existing) {
      channelBinding.set(bridge.channelId, serverId);
      bridges.push({
      channelId: bridge.channelId,
      serverId,
      ...(bridge.useWebhook === true ? { useWebhook: true } : {}),
    });
    }
  }

  return { bridges, problems };
}

/**
 * Log bridge misconfigurations. Called at setup and again after a config
 * reload, so a bad bridge in a guild added later is still reported.
 */
export function reportBridgeProblems(
  guildConfigs: Record<string, GuildConfig>,
  allServerIds: string[],
  tag: string,
): void {
  for (const [guildId, gcfg] of Object.entries(guildConfigs)) {
    const { problems } = resolveGuildBridges(gcfg, allServerIds);
    for (const problem of problems) {
      log.error(tag, `Guild ${guildId}: ${problem}`);
    }
  }
}

const WEBHOOK_NAME = "minecraft-bot bridge";

// channelId → webhook (null = tried and failed; retry on next reload
// only, not per message, so a missing permission can't spam the API).
const webhookCache = new Map<string, Webhook | null>();
// channelId → resolution in flight. Without this, the first burst of chat
// after a (re)start starts one channels.fetch + fetchWebhooks pair per line,
// because none of them has finished populating the cache yet.
const webhookPending = new Map<string, Promise<Webhook | null>>();

/** Exposed for tests / reconcile. */
export function invalidateWebhookCache(): void {
  webhookCache.clear();
  webhookPending.clear();
}

/**
 * The bridge webhook for a channel: reuse ours if it exists, create it
 * once otherwise. Returns null (cached) when the channel doesn't support
 * webhooks or the bot lacks Manage Webhooks — callers fall back to the
 * embed form.
 */
function bridgeWebhook(
  client: Client,
  channelId: string,
): Promise<Webhook | null> {
  if (webhookCache.has(channelId)) {
    return Promise.resolve(webhookCache.get(channelId)!);
  }
  const pending = webhookPending.get(channelId);
  if (pending) return pending;

  const resolving = resolveWebhook(client, channelId).finally(() => {
    webhookPending.delete(channelId);
  });
  webhookPending.set(channelId, resolving);
  return resolving;
}

async function resolveWebhook(
  client: Client,
  channelId: string,
): Promise<Webhook | null> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (
      !channel ||
      !("fetchWebhooks" in channel) ||
      !("createWebhook" in channel)
    ) {
      webhookCache.set(channelId, null);
      return null;
    }
    const hooks = await channel.fetchWebhooks();
    const existing = hooks.find(
      (h) => h.name === WEBHOOK_NAME && h.token !== null,
    );
    const hook =
      existing ??
      (await channel.createWebhook({
        name: WEBHOOK_NAME,
        reason: "chatBridge useWebhook: player-authored bridge messages",
      }));
    webhookCache.set(channelId, hook);
    return hook;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(
      "chatBridge",
      `Webhook unavailable for channel ${channelId} (falling back to embeds): ${msg}`,
    );
    webhookCache.set(channelId, null);
    return null;
  }
}

// ── Outbound send queue ────────────────────────────────────────────────────
// One ordered queue per Discord channel, so a slow send delays only the
// channel it is on.
//
// Why this exists: the handler used to await each send inline, and log
// handlers run one at a time on the watcher's dispatch queue. So a chat line
// held up every *other* watcher — joins, deaths, in-game commands — for the
// duration of a Discord round-trip, and the next chat line waited for this
// one. Webhook execution is the slow case (its own rate-limit bucket, plus
// Discord fetching the mc-heads avatar it has not cached yet), which is
// exactly why the lag showed up with useWebhook on and not without it.
//
// Ordering still matters within a channel — chat arriving out of order reads
// as nonsense — so this serialises per channel rather than firing everything
// in parallel.
const sendQueues = new Map<string, Promise<void>>();
const queueDepth = new Map<string, number>();

/** Depth at which a channel is far enough behind to be worth logging. */
const SEND_QUEUE_WARN_DEPTH = 25;

/** Exposed for tests: drain every pending send. */
export async function flushBridgeQueues(): Promise<void> {
  await Promise.all([...sendQueues.values()]);
}

/**
 * Queue a send for one channel and return immediately.
 *
 * Errors are logged, never rethrown: a rejected link in the chain would
 * strand every message queued behind it on that channel.
 */
function enqueueSend(
  channelId: string,
  send: () => Promise<void>,
  describe: string,
): void {
  const depth = (queueDepth.get(channelId) ?? 0) + 1;
  queueDepth.set(channelId, depth);
  if (depth === SEND_QUEUE_WARN_DEPTH) {
    log.warn(
      "chatBridge",
      `Channel ${channelId} is ${depth} messages behind — Discord sends are ` +
        `slower than in-game chat`,
    );
  }

  const previous = sendQueues.get(channelId) ?? Promise.resolve();
  const next = previous
    .then(send)
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("chatBridge", `${describe}: ${msg}`);
    })
    .finally(() => {
      queueDepth.set(channelId, (queueDepth.get(channelId) ?? 1) - 1);
      // Drop the entry once this was the last link, so channels removed from
      // the config do not accumulate resolved promises forever.
      if (sendQueues.get(channelId) === next) sendQueues.delete(channelId);
    });
  sendQueues.set(channelId, next);
}

/**
 * Resolve every configured bridge webhook up front.
 *
 * Called at setup and after a config reload. Without it the first in-game
 * message of a session pays a channels.fetch plus a fetchWebhooks (and
 * possibly a createWebhook) before anything reaches Discord — which is the
 * one message an operator is most likely to be watching for after a restart.
 */
export function prewarmBridgeWebhooks(
  client: Client,
  guildConfigs: GuildConfigSource,
  allServerIds: string[],
): void {
  for (const gcfg of Object.values(resolveGuildConfigs(guildConfigs))) {
    for (const bridge of resolveGuildBridges(gcfg, allServerIds).bridges) {
      if (!bridge.useWebhook) continue;
      void bridgeWebhook(client, bridge.channelId);
    }
  }
}

export function registerChatBridge(
  logWatcher: ILogWatcher,
  client: Client,
  guildConfigs: GuildConfigSource,
  allServerIds: string[] = [],
): void {
  reportBridgeProblems(
    resolveGuildConfigs(guildConfigs),
    allServerIds,
    "chatBridge",
  );

  prewarmBridgeWebhooks(client, guildConfigs, allServerIds);

  // Note the missing `async`: this handler queues and returns. It must not
  // await Discord — the watcher dispatches handlers one at a time, so waiting
  // here holds up every other watcher for this server as well as the next
  // chat line. Sends are ordered per channel by enqueueSend instead.
  logWatcher.register(CHAT_REGEX, (match) => {
    const [, player, message] = match;
    if (!player || !message) return;
    if (message.startsWith("!")) return;

    const serverId = logWatcher.server.id;

    // Bridges are resolved from the CURRENT config on every line. The
    // watcher is wired once per server at startup, so reading the
    // wired-in snapshot meant a guild added later never got any chat.
    for (const [guildId, gcfg] of Object.entries(
      resolveGuildConfigs(guildConfigs),
    )) {
      const { bridges } = resolveGuildBridges(gcfg, allServerIds);

      // Only channels bound to THIS server receive its chat.
      for (const bridge of bridges) {
        if (bridge.serverId !== serverId) continue;

        enqueueSend(
          bridge.channelId,
          () => deliver(client, bridge, player, message),
          `Failed to send to guild ${guildId}`,
        );
      }
    }
  });
}

/**
 * Put one in-game line into one Discord channel.
 *
 * Webhook form: the player IS the message author (name + head), which reads
 * like a real conversation. Any webhook problem degrades to the embed form
 * rather than losing the message.
 */
async function deliver(
  client: Client,
  bridge: ResolvedBridge,
  player: string,
  message: string,
): Promise<void> {
  if (bridge.useWebhook) {
    const hook = await bridgeWebhook(client, bridge.channelId);
    if (hook) {
      await hook.send({
        username: player.slice(0, 80),
        avatarURL: playerAvatarUrl(player),
        content: message.slice(0, 2000),
        allowedMentions: { parse: [] },
      });
      return;
    }
  }

  const channel = await client.channels.fetch(bridge.channelId);
  if (!channel || !("send" in channel)) return;

  await channel.send({
    embeds: [
      createPlayerEmbed(player, {
        description: message,
        color: EmbedColor.Info,
      }),
    ],
  });
}

/**
 * Set up Discord → Minecraft bridges. The message's channel identifies the
 * one server it is bound to — replies always land where the conversation
 * is happening.
 */
export function setupDiscordToMc(
  client: Client,
  guildConfigs: GuildConfigSource,
  getServerInstance: (id: string | undefined) => ServerInstance | null,
  allServerIds: string[] = [],
): void {
  client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;
    const guildId = msg.guild?.id;
    if (!guildId) return;

    const gcfg = resolveGuildConfigs(guildConfigs)[guildId];
    if (!gcfg?.chatBridge) return;

    const { bridges } = resolveGuildBridges(gcfg, allServerIds);
    const bridge = bridges.find((b) => b.channelId === msg.channel.id);
    if (!bridge) return;

    const server = getServerInstance(bridge.serverId);
    if (!server) return;

    // React instead of silently dropping so the author knows the message
    // did not reach the game.
    if (!bridgeLimiter.consumeToken(msg.author.id)) {
      msg.react("⏳").catch(() => {});
      return;
    }

    // Strip control characters (incl. \r\n, which could inject extra
    // commands via the screen fallback) and cap lengths — printable
    // Unicode stays so umlauts and emoji survive the bridge.
    const { name: safeName, message: safeContent } = sanitizeForConsole(
      msg.author.displayName,
      msg.content,
    );
    await server.sendCommand(`/say [${safeName}] ${safeContent}`);
  });
}
