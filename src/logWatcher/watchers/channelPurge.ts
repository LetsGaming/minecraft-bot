import path from "path";
import type { Client, Message, TextChannel } from "discord.js";
import { loadJson, getRootDir } from "../../utils/utils.js";
import { log } from "../../utils/logger.js";
import { msUntilMidnight } from "../../utils/time.js";
import type { GuildConfig, StatusMessageState } from "../../types/index.js";

const STATUS_STATE_PATH = path.resolve(
  getRootDir(),
  "data",
  "statusMessages.json",
);


/**
 * Purge all messages in a channel except for:
 *  - The status embed message (tracked in data/statusMessages.json)
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
    channel = fetched as TextChannel;
  } catch {
    log.warn("purge", `Failed to fetch channel ${channelId}`);
    return;
  }

  // Collect IDs to protect
  const protectedIds = new Set<string>();

  // 1. Status embed message
  try {
    const state = (await loadJson(STATUS_STATE_PATH)) as StatusMessageState;
    const entry = state[guildId];
    if (entry?.messageId) protectedIds.add(entry.messageId);
  } catch {
    /* no state file yet */
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

  // eslint-disable-next-line no-constant-condition
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
        const errMsg = err instanceof Error ? err.message : String(err);
        log.error("purge", `Bulk delete failed: ${errMsg}`);
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
  guildConfigs: Record<string, GuildConfig>,
): void {
  const guildsWithPurge = Object.entries(guildConfigs).filter(
    ([, cfg]) => cfg.channelPurge?.channelId,
  );

  if (guildsWithPurge.length === 0) {
    log.info("purge", "No channel purge targets configured, skipping");
    return;
  }

  const runPurge = async (): Promise<void> => {
    for (const [guildId, gcfg] of guildsWithPurge) {
      const channelId = gcfg.channelPurge?.channelId;
      if (!channelId) continue;

      try {
        await purgeChannel(client, guildId, channelId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("purge", `Purge failed for guild ${guildId}: ${msg}`);
      }
    }
  };

  // Schedule first run at next midnight, then repeat every 24h
  const delay = msUntilMidnight();
  const delayHours = (delay / 3_600_000).toFixed(1);

  log.info(
    "purge",
    `Channel purge scheduled for ${guildsWithPurge.length} guild(s), next run in ${delayHours}h`,
  );

  setTimeout(() => {
    runPurge();
    setInterval(runPurge, 24 * 60 * 60 * 1000);
  }, delay);
}
