/**
 * JoinLeave, deaths, advancements, and serverEvents each re-implemented
 * the same "loop guilds → fetch channel → send embed → log failure" block.
 * This helper is now the single implementation, and therefore also the single
 * place for:
 *
 *  - the per-server notification filter (notifications.server), and
 *  - the multi-server footer, which is shown when more than one *server*
 *    is configured (the old code wrongly counted *guilds*, so a
 *    one-guild/two-server setup got mixed events with no label).
 */
import { type Client, type EmbedBuilder } from "discord.js";
import { getAllInstances } from "@mcbot/core/utils/server.js";
import { log } from "@mcbot/core/utils/logger.js";
import { runWithGuildLocale } from "@mcbot/core/utils/i18n.js";
import {
  DEFAULT_NOTIFICATION_EVENTS,
  type NotificationEvent,
} from "@mcbot/schema";
import { serverInScope } from "../../utils/guildRouter.js";
import type { GuildConfig } from "@mcbot/core/types/index.js";

// Shared player-name pattern source. \w+ alone silently drops Bedrock
// players whose names Geyser/Floodgate prefixes with "." — every
// watcher regex must use this instead of hand-rolling a fourth copy.
export const PLAYER_NAME = String.raw`[\w.]+`;

export interface BroadcastOptions {
  /** Server the event originated from — used for the scope filter + footer. */
  serverId: string;
  /** Event key matched against notifications.events (a known event key). */
  event: NotificationEvent;
  /** Embed factory — invoked per send so footer state isn't shared. */
  buildEmbed: (withServerFooter: boolean) => EmbedBuilder;
  /** Tag used for error logging (defaults to "notify"). */
  logTag?: string;
}

export async function broadcastNotification(
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
  { serverId, event, buildEmbed, logTag = "notify" }: BroadcastOptions,
): Promise<void> {
  // Footer shows the source server when more than one server exists,
  // regardless of how many guilds are configured.
  const withServerFooter = getAllInstances().length > 1;

  for (const [guildId, gcfg] of Object.entries(guildConfigs)) {
    const notif = gcfg.notifications;
    if (!notif?.channelId) continue;
    // An absent events list means "the default set" — a guild configured with
    // only a channel (what the setup wizard used to write) still receives the
    // common events instead of silently nothing. An explicit empty list is a
    // deliberate opt-out and receives nothing.
    const events = notif.events ?? DEFAULT_NOTIFICATION_EVENTS;
    if (!events.includes(event)) continue;
    // serverInScope guarantees an unpinned channel never receives
    // another tenant's events.
    if (!serverInScope(notif.server, serverId, guildId)) continue;

    try {
      const channel = await client.channels.fetch(notif.channelId);
      if (!channel || !("send" in channel)) continue;

      // Embeds are built per guild inside its locale context, so t()
      // calls in buildEmbed resolve this guild's language.
      const embed = runWithGuildLocale(guildId, () =>
        buildEmbed(withServerFooter),
      );
      await channel.send({ embeds: [embed] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(logTag, `Failed: ${msg}`);
    }
  }
}
