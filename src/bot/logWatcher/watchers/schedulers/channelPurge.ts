import type { Client, Message, TextChannel } from "discord.js";
import { kvGet } from "@mcbot/core/db/kv.js";
import { log } from "@mcbot/core/utils/logger.js";
import { nextMidnightEpoch } from "@mcbot/core/utils/time.js";
import { guildTimeZone } from "@mcbot/core/utils/config/timezones.js";
import { scheduleAt, type LongTimer } from "@mcbot/core/utils/longTimer.js";
import {
  guildsWith,
  type GuildConfigSource,
} from "../../../utils/guild/guildConfigs.js";
import type { GuildConfig, StatusMessageState } from "@mcbot/core/types/index.js";
import { errMsg } from "@mcbot/core/utils/error.js";

/**
 * Purge all messages in a channel except for:
 *  - The status embed message (tracked in kv_store["statusMessages"])
 *  - Any pinned messages
 */
async function purgeChannel(
  client: Client,
  guildId: string,
  channelId: string,
): Promise<void> {
  let channel: TextChannel;
  try {
    const fetched = await client.channels.fetch(channelId);
    if (!fetched || !("messages" in fetched)) {
      log.warn(
        "purge",
        `Channel ${channelId} not accessible for guild ${guildId}`,
      );
      return;
    }
    // The `"messages" in fetched` guard above proves this is a message-capable
    // channel; discord.js's fetch() union can't be narrowed to a concrete
    // TextChannel through an `in` check, and purge only ever runs against
    // configured guild text channels, so we assert that concrete type here.
    channel = fetched as TextChannel;
  } catch {
    log.warn("purge", `Failed to fetch channel ${channelId}`);
    return;
  }

  // Collect IDs to protect
  const protectedIds = new Set<string>();

  // 1. Status embed message
  try {
    const state = kvGet<StatusMessageState>("statusMessages") ?? {};
    const entry = state[guildId];
    if (entry?.messageId) protectedIds.add(entry.messageId);
  } catch {
    /* store not readable — protect nothing extra */
  }

  // 2. Pinned messages
  try {
    const pinned = await channel.messages.fetchPins();
    for (const msg of pinned.items) {
      protectedIds.add(msg.message.id);
    }
  } catch {
    log.warn("purge", `Could not fetch pinned messages in ${channelId}`);
  }

  // Fetch and delete in batches (Discord API returns max 100 per fetch)
  let totalDeleted = 0;
  let lastId: string | undefined;

  while (true) {
    const fetchOptions: { limit: number; before?: string } = { limit: 100 };
    if (lastId) fetchOptions.before = lastId;

    const batch = await channel.messages.fetch(fetchOptions);
    if (batch.size === 0) break;

    const toDelete: Message[] = [];
    for (const msg of batch.values()) {
      if (!protectedIds.has(msg.id)) toDelete.push(msg);
      lastId = msg.id;
    }

    if (toDelete.length === 0) {
      // All remaining messages are protected — keep scanning
      if (batch.size < 100) break;
      continue;
    }

    // Split into bulk-deletable (<14 days) and old messages
    const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const bulkable = toDelete.filter(
      (m) => m.createdTimestamp > fourteenDaysAgo,
    );
    const old = toDelete.filter((m) => m.createdTimestamp <= fourteenDaysAgo);

    // Bulk delete (2+ messages)
    if (bulkable.length >= 2) {
      try {
        const deleted = await channel.bulkDelete(bulkable, true);
        totalDeleted += deleted.size;
      } catch (err) {
        log.error("purge", `Bulk delete failed: ${errMsg(err)}`);
      }
    } else if (bulkable.length === 1) {
      old.push(bulkable[0]!);
    }

    // Single-delete old messages (rate-limited, but necessary)
    for (const msg of old) {
      try {
        await msg.delete();
        totalDeleted++;
      } catch {
        /* message may already be gone */
      }
    }

    if (batch.size < 100) break;
  }

  log.info(
    "purge",
    `Purged ${totalDeleted} message(s) from #${channel.name} (guild ${guildId}), kept ${protectedIds.size} protected`,
  );
}

/**
 * Schedule the daily purge for all guilds that have channelPurge configured.
 */
export function startChannelPurge(
  client: Client,
  guildConfigs: GuildConfigSource,
): void {
  // Targets are resolved when the purge RUNS, not when it is scheduled:
  // returning early here used to leave the daily timer unscheduled for the
  // whole process, so a channelPurge block added on config reload (or a
  // second guild configured later) never purged anything.
  const purgeTargets = (): Array<[string, GuildConfig]> =>
    guildsWith(guildConfigs, (cfg) => !!cfg.channelPurge?.channelId);

  if (purgeTargets().length === 0) {
    log.info(
      "purge",
      "No channel purge targets configured yet — timer armed, targets re-read at each run",
    );
  }

  /** One timer per guild — each fires at *that guild's* midnight. */
  const timers = new Map<string, LongTimer>();

  const purgeGuild = async (guildId: string): Promise<void> => {
    // Re-read config at fire time: the channel may have changed, or the
    // feature been turned off, since the timer was armed.
    const cfg = purgeTargets().find(([id]) => id === guildId)?.[1];
    const channelId = cfg?.channelPurge?.channelId;
    if (!channelId) return;
    try {
      await purgeChannel(client, guildId, channelId);
    } catch (err) {
      log.error("purge", `Purge failed for guild ${guildId}: ${errMsg(err)}`);
    }
  };

  /**
   * Arm the next purge for one guild, at midnight in its own timezone.
   *
   * Re-computed after every run rather than a fixed 24h interval: an
   * interval drifts by an hour at each DST transition, and the guild's
   * configured zone can change under a /config reload.
   */
  function scheduleGuild(guildId: string): void {
    timers.get(guildId)?.cancel();
    const tz = guildTimeZone(guildId);
    const due = nextMidnightEpoch(tz);
    log.debug(
      "purge",
      `Guild ${guildId}: next purge at ${new Date(due).toISOString()} (midnight ${tz})`,
    );
    timers.set(
      guildId,
      scheduleAt(due, () => {
        void purgeGuild(guildId).finally(() => {
          syncTimers(); // picks up config changes, then re-arms this guild
        });
      }),
    );
  }

  /**
   * Reconcile timers with config: arm guilds that gained a purge channel,
   * drop those that lost one. Called at startup and after each run, so a
   * guild configured at runtime joins at its next midnight.
   */
  function syncTimers(): void {
    const wanted = new Set(purgeTargets().map(([id]) => id));
    for (const guildId of timers.keys()) {
      if (!wanted.has(guildId)) {
        timers.get(guildId)?.cancel();
        timers.delete(guildId);
      }
    }
    for (const guildId of wanted) scheduleGuild(guildId);
  }

  syncTimers();

  // Re-check config on a slow tick as well: without it, a deployment with
  // no purge targets at boot would never arm anything, because the only
  // other reconcile point is the end of a run that never happens.
  setInterval(syncTimers, 60 * 60 * 1000).unref();
}
