import { type Client, type Message, type Webhook } from "discord.js";
import { EmbedCategory } from "@mcbot/schema/embedCategories.js";
import { log } from "@mcbot/core/utils/logger.js";
import { createEmbed, createPlayerEmbed } from "../../../utils/embeds/embedUtils.js";
import { playerAvatarUrl } from "../../../utils/mcHeads.js";
import type { ILogWatcher } from "../../logWatcher.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import type { GuildConfig, GuildChatBridgeConfig } from "@mcbot/core/types/index.js";
import { sanitizeForComponent } from "@mcbot/core/utils/sanitize.js";
import {
  createRateLimiter,
  bridgeLimiterSettings,
  relayLimiterSettings,
  relaySyncWindowMs,
} from "@mcbot/core/utils/rateLimiter.js";
import { isRelayOptedOut } from "@mcbot/core/utils/stores/relayOptOutStore.js";
import {
  resolveGuildConfigs,
  type GuildConfigSource,
} from "../../../utils/guild/guildConfigs.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { tellraw } from "@mcbot/core/utils/minecraft/serverMessages.js";
import { safeMentions } from "../../../utils/embeds/alertUtils.js";
import { chatLineRegex } from "./chatLine.js";
import { enqueueSend, flushSendQueues } from "../sendQueue.js";
import { fetchSendable } from "../notifyGuilds.js";
import { isChannelGone, isUnknownMessage, isUnknownWebhook } from "../discordErrors.js";
import { relaySpeaker } from "./relay/identity.js";
import {
  planRelay,
  relayDelete,
  relayEdit,
  relayMessage,
  type RelaySender,
  type RelayTarget,
} from "./relay/relayBridge.js";
import { RelaySyncMap, type RelayedCopy } from "./relay/syncMap.js";
import type { RelayInput } from "./relay/transform.js";

// Anchored on the speaker: see chatLine.ts.
const CHAT_REGEX = chatLineRegex(String.raw`\s+(.+)`);

// The bridge listens on messageCreate, so the slash-command limiter never
// sees it, it needs its own bucket or any member could flood the game
// console at Discord message speed. Burst of 8, ~0.8 msg/s sustained:
// fine for lively chat, stops floods.
// Capacity/window come from the `limits` config block (defaults 8/10s);
// the limiter shape is fixed at module load, changing limits needs a
// restart, same as the slash limiter.
const bridgeLimiter = createRateLimiter(bridgeLimiterSettings());

// One bucket per relay group on top of the per-author one, so several chatty
// servers cannot turn a group into a flood in each other's channels.
const relayLimiter = createRateLimiter(relayLimiterSettings());

// Source message id to its copies in other servers (ids only, in memory).
const relaySync = new RelaySyncMap();

/** The configured server ids, fixed or resolved per event. */
export type ServerIdSource = string[] | (() => string[]);

function resolveServerIds(source: ServerIdSource): string[] {
  return typeof source === "function" ? source() : source;
}

/** A bridge after normalization: one channel ↔ exactly one server. */
export interface ResolvedBridge {
  channelId: string;
  serverId: string;
  useWebhook?: boolean;
  /** Bridges with the same group and server forward chat to each other. */
  relayGroup?: string;
}

/**
 * Normalize a guild's chatBridge config (single object or array) into
 * unambiguous channel↔server pairs.
 *
 * Deliberately strict: one channel ↔ exactly one server, both directions,
 * so conversations from different servers can never mix in one channel.
 * `server` may only be omitted when it's unambiguous (guild defaultServer,
 * or a single configured server); anything else is a problem, skipped,
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
        ...(bridge.relayGroup ? { relayGroup: bridge.relayGroup } : {}),
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
 * webhooks or the bot lacks Manage Webhooks, callers fall back to the
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
    log.warn(
      "chatBridge",
      `Webhook unavailable for channel ${channelId} (falling back to embeds): ${errMsg(err)}`,
    );
    webhookCache.set(channelId, null);
    return null;
  }
}

/** Exposed for tests: drain every pending send. */
export const flushBridgeQueues = flushSendQueues;

/**
 * Resolve every configured bridge webhook up front.
 *
 * Called at setup and after a config reload. Without it the first in-game
 * message of a session pays a channels.fetch plus a fetchWebhooks (and
 * possibly a createWebhook) before anything reaches Discord, which is the
 * one message an operator is most likely to be watching for after a restart.
 */
export function prewarmBridgeWebhooks(
  client: Client,
  guildConfigs: GuildConfigSource,
  allServerIds: ServerIdSource,
): void {
  const serverIds = resolveServerIds(allServerIds);
  for (const gcfg of Object.values(resolveGuildConfigs(guildConfigs))) {
    for (const bridge of resolveGuildBridges(gcfg, serverIds).bridges) {
      if (!bridge.useWebhook) continue;
      void bridgeWebhook(client, bridge.channelId);
    }
  }
}

/**
 * Guild-config sources whose bridges were already checked and prewarmed for a
 * client. registerChatBridge runs once per server, but the checks are about
 * the whole config, so only the first registration for a source does them (a
 * config reload re-runs them explicitly).
 */
const checkedSources = new WeakMap<Client, WeakSet<object>>();

function firstRegistrationFor(client: Client, source: GuildConfigSource): boolean {
  let seen = checkedSources.get(client);
  if (!seen) {
    seen = new WeakSet();
    checkedSources.set(client, seen);
  }
  if (seen.has(source)) return false;
  seen.add(source);
  return true;
}

export function registerChatBridge(
  logWatcher: ILogWatcher,
  client: Client,
  guildConfigs: GuildConfigSource,
  allServerIds: ServerIdSource = [],
): void {
  if (firstRegistrationFor(client, guildConfigs)) {
    reportBridgeProblems(
      resolveGuildConfigs(guildConfigs),
      resolveServerIds(allServerIds),
      "chatBridge",
    );
    prewarmBridgeWebhooks(client, guildConfigs, allServerIds);
  }

  // Note the missing `async`: this handler queues and returns. It must not
  // await Discord QQ the watcher dispatches handlers one at a time, so waiting
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
      const { bridges } = resolveGuildBridges(
        gcfg,
        resolveServerIds(allServerIds),
      );

      // Only channels bound to THIS server receive its chat.
      for (const bridge of bridges) {
        if (bridge.serverId !== serverId) continue;

        void enqueueSend(
          bridge.channelId,
          () => deliver(client, bridge, player, message),
          `Failed to send to guild ${guildId}`,
          "chatBridge",
        );
      }
    }
  });
}

/** What one post looks like in the webhook form and, when that fails, as an embed. */
interface Post {
  username: string;
  /** Webhook avatar; omitted, Discord shows the webhook's own. */
  avatarURL?: string;
  content: string;
  embed: () => ReturnType<typeof createEmbed>;
}

/**
 * Post one line to a bridged channel and say where it landed. Any webhook
 * problem degrades to the embed form rather than losing the message.
 * Null when Discord gave no message id back or the channel cannot take
 * messages.
 */
async function postLine(
  client: Client,
  bridge: { channelId: string; useWebhook?: boolean },
  post: Post,
): Promise<RelayedCopy | null> {
  if (bridge.useWebhook) {
    const hook = await bridgeWebhook(client, bridge.channelId);
    if (hook) {
      // A webhook send that fails falls through to the embed form. Discord
      // refuses some usernames ("discord", "clyde") outright; a deleted
      // webhook (10015 / 404) or channel is evicted so the next line resolves
      // a fresh one instead of failing until a reload.
      try {
        const sent = (await hook.send({
          username: post.username.slice(0, 80),
          ...(post.avatarURL ? { avatarURL: post.avatarURL } : {}),
          content: post.content.slice(0, 2000),
          allowedMentions: safeMentions("none"),
        })) as { id?: string } | undefined;
        return sent?.id
          ? { channelId: bridge.channelId, messageId: sent.id, viaWebhook: true }
          : null;
      } catch (err) {
        if (isUnknownWebhook(err) || isChannelGone(err)) {
          webhookCache.delete(bridge.channelId);
        }
        log.warn(
          "chatBridge",
          `Webhook send failed in channel ${bridge.channelId} (sending as embed): ${errMsg(err)}`,
        );
      }
    }
  }

  const channel = await fetchSendable(client, bridge.channelId);
  if (!channel) return null;

  const sent = (await channel.send({
    embeds: [post.embed()],
    allowedMentions: safeMentions("none"),
  })) as { id?: string } | undefined;
  return sent?.id ? { channelId: bridge.channelId, messageId: sent.id, viaWebhook: false } : null;
}

/**
 * Put one in-game line into one Discord channel.
 *
 * Webhook form: the player IS the message author (name + head), which reads
 * like a real conversation.
 */
async function deliver(
  client: Client,
  bridge: ResolvedBridge,
  player: string,
  message: string,
): Promise<void> {
  await postLine(client, bridge, {
    username: player,
    avatarURL: playerAvatarUrl(player),
    content: message,
    embed: () =>
      createPlayerEmbed(player, {
        description: message,
        category: EmbedCategory.Chat,
      }),
  });
}

/**
 * How relayed Discord messages are posted, edited and removed. A copy carries
 * no avatar (the webhook's own shows) and is only an embed when the webhook is
 * unusable.
 */
function relaySender(client: Client): RelaySender {
  const relayEmbed = (username: string, content: string, iconURL?: string) =>
    createEmbed({
      description: content,
      category: EmbedCategory.Chat,
      author: { name: username, ...(iconURL ? { iconURL } : {}) },
    });
  return {
    send: (target: RelayTarget, post: { username: string; content: string; avatarURL?: string }) =>
      postLine(client, target, {
        username: post.username,
        ...(post.avatarURL ? { avatarURL: post.avatarURL } : {}),
        content: post.content,
        embed: () => relayEmbed(post.username, post.content, post.avatarURL),
      }),
    async edit(copy, content) {
      try {
        if (copy.viaWebhook) {
          const hook = await bridgeWebhook(client, copy.channelId);
          await hook?.editMessage(copy.messageId, {
            content,
            allowedMentions: safeMentions("none"),
          });
          return;
        }
        const channel = await fetchSendable(client, copy.channelId);
        const message = await channel?.messages.fetch(copy.messageId);
        if (!message) return;
        await message.edit({
          embeds: [
            relayEmbed(message.embeds[0]?.author?.name ?? "?", content, message.embeds[0]?.author?.iconURL),
          ],
          allowedMentions: safeMentions("none"),
        });
      } catch (err) {
        if (!isUnknownMessage(err)) {
          log.warn("chatBridge", `Relayed edit failed in channel ${copy.channelId}: ${errMsg(err)}`);
        }
      }
    },
    async remove(copy) {
      try {
        if (copy.viaWebhook) {
          const hook = await bridgeWebhook(client, copy.channelId);
          await hook?.deleteMessage(copy.messageId);
          return;
        }
        const channel = await fetchSendable(client, copy.channelId);
        await channel?.messages.delete(copy.messageId);
      } catch (err) {
        if (!isUnknownMessage(err)) {
          log.warn("chatBridge", `Relayed delete failed in channel ${copy.channelId}: ${errMsg(err)}`);
        }
      }
    },
  };
}

function relayInputOf(msg: Message): RelayInput {
  return {
    content: msg.content,
    attachments: [...msg.attachments.values()].map((a) => a.contentType),
    stickers: msg.stickers.size,
    isReply: Boolean(msg.reference?.messageId),
  };
}

/** Every guild's resolved bridges, for working out who a relayed message goes to. */
export function resolveAllBridges(
  guildConfigs: GuildConfigSource,
  allServerIds: ServerIdSource,
): Record<string, ResolvedBridge[]> {
  const serverIds = resolveServerIds(allServerIds);
  return Object.fromEntries(
    Object.entries(resolveGuildConfigs(guildConfigs)).map(([guildId, gcfg]) => [
      guildId,
      resolveGuildBridges(gcfg, serverIds).bridges,
    ]),
  );
}

/**
 * Set up Discord → Minecraft bridges. The message's channel identifies the
 * one server it is bound to, replies always land where the conversation
 * is happening.
 */
export function setupDiscordToMc(
  client: Client,
  guildConfigs: GuildConfigSource,
  getServerInstance: (id: string | undefined) => ServerInstance | null,
  allServerIds: ServerIdSource = [],
): void {
  const relay = async (msg: Message): Promise<void> => {
    if (msg.author.bot) return;
    const guildId = msg.guild?.id;
    if (!guildId) return;

    const gcfg = resolveGuildConfigs(guildConfigs)[guildId];
    if (!gcfg?.chatBridge) return;

    const { bridges } = resolveGuildBridges(
      gcfg,
      resolveServerIds(allServerIds),
    );
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

    // In a relay group the speaker goes by one identity everywhere, so the
    // censoring cannot be bypassed by reading chat in game.
    const plan = planRelay(resolveAllBridges(guildConfigs, allServerIds), {
      guildId,
      channelId: msg.channel.id,
    });
    const relaySpeakerOf = plan
      ? await relaySpeaker(msg.author.id, msg.author.displayName, plan.group)
      : null;
    const speaker = relaySpeakerOf?.name ?? msg.author.displayName;

    // Strip control characters (incl. \r\n, which could inject extra
    // commands via the screen fallback) and cap lengths, printable
    // Unicode stays so umlauts and emoji survive the bridge.
    const { name: safeName, message: safeContent } = sanitizeForComponent(
      speaker,
      msg.content,
    );
    // tellraw, not /say. A /say line lands in the server log as
    // `[Server] [name] text`, where text a Discord user typed (`x]: <Admin>`)
    // could pose as a player to the log watchers; /say also expands
    // selectors like @a. A text component is shown verbatim and not logged.
    const relayed = [
      "",
      { text: `[${safeName}] `, color: "aqua" },
      { text: safeContent },
    ];
    if (!(await tellraw(server, "@a", relayed))) {
      msg.react("⚠️").catch(() => {});
    }

    if (!plan) return;
    if (isRelayOptedOut(guildId, msg.author.id) || gcfg.bridgeBlocklist?.includes(msg.author.id)) {
      msg.react("🚫").catch(() => {});
      return;
    }
    if (!relayLimiter.consumeToken(plan.group)) {
      msg.react("⏳").catch(() => {});
      return;
    }
    await relayMessage(
      plan,
      {
        sourceMessageId: msg.id,
        input: relayInputOf(msg),
        name: speaker,
        ...(relaySpeakerOf?.linked ? { avatarURL: playerAvatarUrl(speaker) } : {}),
        label: gcfg.bridgeLabel || msg.guild?.name || "?",
        windowMs: relaySyncWindowMs(),
      },
      relaySender(client),
      relaySync,
    );
  };
  // A rejection from an async listener would reach the process guard and
  // exit the bot.
  client.on("messageCreate", (msg) =>
    relay(msg).catch((err: unknown) => {
      log.error("chatBridge", `Discord → MC relay failed: ${errMsg(err)}`);
    }),
  );
  setupRelaySync(client);
}

const relaySyncAttached = new WeakSet<Client>();

/** Edits and deletes of a relayed message reach its copies for as long as the sync window lasts. */
function setupRelaySync(client: Client): void {
  if (relaySyncAttached.has(client)) return;
  relaySyncAttached.add(client);
  const sender = relaySender(client);
  const guarded = (what: string, run: () => Promise<void>): void => {
    run().catch((err: unknown) => {
      log.error("chatBridge", `Relay ${what} sync failed: ${errMsg(err)}`);
    });
  };
  client.on("messageUpdate", (_old, updated) => {
    if (updated.partial || updated.author?.bot || !relaySync.copiesOf(updated.id)) return;
    guarded("edit", () => relayEdit(updated.id, relayInputOf(updated), sender, relaySync));
  });
  client.on("messageDelete", (deleted) => {
    if (!relaySync.copiesOf(deleted.id)) return;
    guarded("delete", () => relayDelete(deleted.id, sender, relaySync));
  });
}
