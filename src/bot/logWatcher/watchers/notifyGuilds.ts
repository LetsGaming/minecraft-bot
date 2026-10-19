/**
 * The one implementation of "for every guild subscribed to this server, send
 * a message to its configured channel". It owns:
 *
 *  - the scope filter (`serverInScope`), so an unpinned channel never
 *    receives another tenant's events,
 *  - building each message inside the guild's locale context,
 *  - the mention policy (silent unless a mention is supplied),
 *  - per-channel ordering and error logging, through the shared send queue,
 *  - for `broadcastNotification`, the per-server notification filter
 *    (notifications.server) and the multi-server footer, which is shown when
 *    more than one *server* is configured.
 */
import {
  type Channel,
  type Client,
  type EmbedBuilder,
  type MessageCreateOptions,
} from "discord.js";
import { getAllInstances } from "@mcbot/core/utils/server/server.js";
import { runWithGuildLocale } from "@mcbot/core/utils/i18n.js";
import type { GuildConfig } from "@mcbot/core/types/index.js";
import {
  DEFAULT_NOTIFICATION_EVENTS,
  type NotificationEvent,
} from "@mcbot/schema";
import { serverInScope } from "../../utils/guild/guildRouter.js";
import {
  resolveGuildConfigs,
  type GuildConfigSource,
} from "../../utils/guild/guildConfigs.js";
import { safeMentions, type AlertMention } from "../../utils/embeds/alertUtils.js";
import { enqueueSend } from "./sendQueue.js";

export type SendableChannel = Extract<Channel, { send: unknown }>;

/** The channel, or null when it does not exist or cannot take messages. */
export async function fetchSendable(
  client: Client,
  channelId: string,
): Promise<SendableChannel | null> {
  const channel = await client.channels.fetch(channelId);
  return channel && "send" in channel ? channel : null;
}

/** The part of a guild's feature block that routes a message. */
export interface ChannelTarget {
  channelId?: string;
  /** One server ID, a list, or unset = every server this guild can see. */
  server?: string | string[];
}

export interface GuildTarget<T extends ChannelTarget> {
  guildId: string;
  target: T & { channelId: string };
}

/**
 * The guilds whose `pick`ed block has a channel and covers `serverId`.
 * Resolved per call: watchers are wired once at startup, so a fixed record
 * would never see a guild added by a later config reload.
 */
export function guildTargets<T extends ChannelTarget>(
  guildConfigs: GuildConfigSource,
  pick: (gcfg: GuildConfig) => T | undefined,
  serverId: string,
): GuildTarget<T>[] {
  const targets: GuildTarget<T>[] = [];
  for (const [guildId, gcfg] of Object.entries(resolveGuildConfigs(guildConfigs))) {
    const target = pick(gcfg);
    if (!target?.channelId) continue;
    if (!serverInScope(target.server, serverId, guildId)) continue;
    targets.push({ guildId, target: target as T & { channelId: string } });
  }
  return targets;
}

export interface SendToGuildsOptions<T extends ChannelTarget> {
  /** The feature block to send to; undefined skips the guild. */
  pick: (gcfg: GuildConfig) => T | undefined;
  /** Server the message originates from, for the scope filter. */
  serverId: string;
  /** Message factory, invoked inside the guild's locale context. */
  build: (target: T, guildId: string) => Omit<MessageCreateOptions, "allowedMentions">;
  /** Mention fields for the guild; omit for a silent message. */
  mention?: (target: T) => AlertMention;
  /** Tag used for error logging. */
  logTag: string;
  /** Prefix of the logged error line. */
  describe?: string;
}

/**
 * Send one message to every subscribed guild's channel. Resolves once every
 * send has run; failures are logged per channel and never thrown, so callers
 * on a log-dispatch queue can drop the promise instead of awaiting it.
 */
export async function sendToGuildChannels<T extends ChannelTarget>(
  client: Client,
  guildConfigs: GuildConfigSource,
  { pick, serverId, build, mention, logTag, describe = "Failed to send" }: SendToGuildsOptions<T>,
): Promise<void> {
  const sends: Promise<void>[] = [];
  for (const { guildId, target } of guildTargets(guildConfigs, pick, serverId)) {
    sends.push(
      enqueueSend(
        target.channelId,
        async () => {
          const channel = await fetchSendable(client, target.channelId);
          if (!channel) return;
          const payload = runWithGuildLocale(guildId, () => build(target, guildId));
          const ping = mention?.(target);
          await channel.send({
            ...payload,
            ...(ping?.content
              ? { content: [ping.content, payload.content].filter(Boolean).join("\n") }
              : {}),
            allowedMentions: ping?.allowedMentions ?? safeMentions("none"),
          });
        },
        `${describe} (guild ${guildId})`,
        logTag,
      ),
    );
  }
  await Promise.all(sends);
}

export interface BroadcastOptions {
  /** Server the event originated from: used for the scope filter + footer. */
  serverId: string;
  /** Event key matched against notifications.events (a known event key). */
  event: NotificationEvent;
  /** Embed factory, invoked per send so footer state isn't shared. */
  buildEmbed: (withServerFooter: boolean) => EmbedBuilder;
  /** Tag used for error logging (defaults to "notify"). */
  logTag?: string;
}

export function broadcastNotification(
  client: Client,
  guildConfigs: GuildConfigSource,
  { serverId, event, buildEmbed, logTag = "notify" }: BroadcastOptions,
): Promise<void> {
  // Footer shows the source server when more than one server exists,
  // regardless of how many guilds are configured.
  const withServerFooter = getAllInstances().length > 1;

  return sendToGuildChannels(client, guildConfigs, {
    serverId,
    logTag,
    describe: "Failed",
    // An absent events list means "the default set": a guild configured with
    // only a channel (what the setup wizard used to write) still receives the
    // common events instead of silently nothing. An explicit empty list is a
    // deliberate opt-out and receives nothing.
    pick: (gcfg) => {
      const notif = gcfg.notifications;
      const events = notif?.events ?? DEFAULT_NOTIFICATION_EVENTS;
      return events.includes(event) ? notif : undefined;
    },
    build: () => ({ embeds: [buildEmbed(withServerFooter)] }),
  });
}
