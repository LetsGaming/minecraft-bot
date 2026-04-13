import path from 'path';
import { EmbedBuilder, type Client, type TextChannel, type VoiceChannel } from 'discord.js';
import { getAllInstances } from '../../utils/server.js';
import { loadJson, saveJson, getRootDir } from '../../utils/utils.js';
import { log } from '../../utils/logger.js';
import {
  ensureManagedCategory,
  ensureTextChannel,
  ensureVoiceChannel,
  renameVoiceChannelIfChanged,
} from '../../utils/discordChannel.js';
import type {
  GuildConfig,
  StatusChannelState,
  StatusMessageState,
  TpsResult,
} from '../../types/index.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const STATE_PATH = path.resolve(getRootDir(), 'data', 'statusMessages.json');
const UPDATE_INTERVAL_MS = 60 * 1_000;
const INITIAL_DELAY_MS = 5_000;

/**
 * Display names for the bot-managed Discord channels.
 * Voice channels accept unicode/emoji/spaces freely, so the counter channel
 * can use a human-friendly format. The text channel name must be lowercase
 * letters, numbers, and hyphens only (Discord text channel restriction).
 */
const CATEGORY_NAME = '📊 Server Status';
const STATUS_TEXT_CHANNEL_NAME = 'server-status';
const buildVoiceChannelName = (online: number, max: number) =>
  `👥 Players: ${online} / ${max}`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlayerCounts {
  online: number;
  max: number;
}

interface StatusBuildResult {
  embed: EmbedBuilder;
  counts: PlayerCounts;
}

/**
 * Cached live Discord channel references per guild, so we avoid fetching
 * them from the API on every update cycle.
 */
interface GuildChannelRefs {
  textChannel: TextChannel;
  voiceChannel: VoiceChannel;
  lastCounts: PlayerCounts;
}

// ─── State ────────────────────────────────────────────────────────────────────

const channelRefCache = new Map<string, GuildChannelRefs>();

// ─── Persistence ──────────────────────────────────────────────────────────────

async function loadState(): Promise<StatusMessageState> {
  const data = await loadJson(STATE_PATH).catch(() => ({}));
  return (data as StatusMessageState) ?? {};
}

async function saveState(state: StatusMessageState): Promise<void> {
  await saveJson(STATE_PATH, state);
}

// ─── Channel provisioning ─────────────────────────────────────────────────────

/**
 * Ensure the bot's managed category and both child channels exist in the guild.
 *
 * On first run this creates everything from scratch. On subsequent runs it
 * validates the persisted IDs against the live guild channel cache and
 * re-creates anything that was manually deleted.
 */
async function provisionGuildChannels(
  client: Client,
  guildId: string,
  state: StatusMessageState,
): Promise<{ textChannel: TextChannel; voiceChannel: VoiceChannel; stored: StatusChannelState } | null> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    log.warn('status', `Guild ${guildId} not in cache, skipping provisioning`);
    return null;
  }

  // Resolve channels from persisted state first to avoid unnecessary API calls
  const stored = state[guildId];
  if (stored) {
    const textChannel = guild.channels.cache.get(stored.textChannelId) as TextChannel | undefined;
    const voiceChannel = guild.channels.cache.get(stored.voiceChannelId) as VoiceChannel | undefined;
    if (textChannel && voiceChannel) {
      return { textChannel, voiceChannel, stored };
    }
    log.info('status', `Re-provisioning channels for guild ${guildId} (one or more channels missing)`);
  }

  try {
    const { category } = await ensureManagedCategory(guild, CATEGORY_NAME);

    const { channel: textChannel } = await ensureTextChannel(
      guild,
      category.id,
      STATUS_TEXT_CHANNEL_NAME,
      'Live Minecraft server status — managed by the bot.',
    );

    const { channel: voiceChannel } = await ensureVoiceChannel(
      guild,
      category.id,
      buildVoiceChannelName(0, 0),
    );

    const newState: StatusChannelState = {
      categoryId: category.id,
      textChannelId: textChannel.id,
      messageId: stored?.messageId ?? '',
      voiceChannelId: voiceChannel.id,
    };
    state[guildId] = newState;
    await saveState(state);

    log.info(
      'status',
      `Provisioned status channels for guild ${guildId} ` +
      `(category: ${category.id}, text: ${textChannel.id}, voice: ${voiceChannel.id})`,
    );

    return { textChannel, voiceChannel, stored: newState };
  } catch (err) {
    log.error(
      'status',
      `Failed to provision channels for guild ${guildId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

// ─── Embed builder ────────────────────────────────────────────────────────────

function buildTpsLine(tps: TpsResult | null): string {
  if (tps?.tps1m == null) return '';
  const emoji = tps.tps1m >= 18 ? '🟢' : tps.tps1m >= 15 ? '🟡' : '🔴';
  return `\nTPS: ${emoji} ${tps.tps1m.toFixed(1)}`;
}

function buildPlayerListLine(players: string[]): string {
  return players.length > 0 ? `\nOnline: ${players.join(', ')}` : '';
}

async function buildServerField(
  server: ReturnType<typeof getAllInstances>[number],
  isInline: boolean,
): Promise<{ field: { name: string; value: string; inline: boolean }; counts: PlayerCounts }> {
  let isOnline = false;
  let tps: TpsResult | null = null;
  const counts: PlayerCounts = { online: 0, max: 0 };

  // Check online status before TPS — running both in parallel on a cold RCON
  // connection can poison the internal _hasTpsCommand cache permanently.
  try {
    isOnline = await server.isRunning();
  } catch {
    /* treat as offline */
  }

  if (isOnline && server.useRcon) {
    try {
      tps = await server.getTps();
    } catch {
      /* TPS unavailable this cycle */
    }
  }

  if (!isOnline) {
    return {
      field: { name: server.id, value: '🔴 Offline', inline: isInline },
      counts,
    };
  }

  let statusLine = '🟢 Online';

  try {
    const list = await server.getList();
    counts.online = parseInt(String(list.playerCount), 10) || 0;
    counts.max = parseInt(String(list.maxPlayers), 10) || 0;
    const players: string[] = list.players ?? [];

    statusLine =
      `🟢 Online — ${counts.online}/${counts.max} players` +
      buildTpsLine(tps) +
      buildPlayerListLine(players);
  } catch {
    statusLine += buildTpsLine(tps);
  }

  return {
    field: { name: server.id, value: statusLine, inline: isInline },
    counts,
  };
}

async function buildStatusEmbed(): Promise<StatusBuildResult> {
  const instances = getAllInstances();
  const isInline = instances.length <= 3;
  const total: PlayerCounts = { online: 0, max: 0 };

  const results = await Promise.allSettled(
    instances.map((s) => buildServerField(s, isInline)),
  );

  const fields = results.map((result, i) => {
    const instanceId = instances[i]?.id ?? `server-${i + 1}`;
    if (result.status === 'fulfilled') {
      total.online += result.value.counts.online;
      total.max += result.value.counts.max;
      return result.value.field;
    }
    return { name: instanceId, value: '⚠️ Error fetching status', inline: isInline };
  });

  const embed = new EmbedBuilder()
    .setTitle('📊 Server Status')
    .setColor(0x00bfff)
    .setTimestamp()
    .setFooter({ text: 'Updates every 60s' });

  if (fields.length > 0) {
    embed.addFields(fields);
  } else {
    embed.setDescription('No servers configured.');
  }

  return { embed, counts: total };
}

// ─── Per-channel updates ──────────────────────────────────────────────────────

/**
 * Send a new status embed or edit the existing pinned one.
 * Persists the message ID so the same message is edited on every cycle.
 */
async function sendOrUpdateEmbed(
  textChannel: TextChannel,
  embed: EmbedBuilder,
  guildId: string,
  state: StatusMessageState,
): Promise<void> {
  const stored = state[guildId];
  const messageId = stored?.messageId;

  if (messageId) {
    try {
      const msg = await textChannel.messages.fetch(messageId);
      await msg.edit({ embeds: [embed] });
      return;
    } catch {
      log.info('status', `Embed message missing for guild ${guildId}, sending a new one`);
    }
  }

  try {
    const msg = await textChannel.send({ embeds: [embed] });
    if (stored) {
      stored.messageId = msg.id;
      await saveState(state);
    }
    log.info('status', `Sent status embed in guild ${guildId}`);
  } catch (err) {
    log.error(
      'status',
      `Failed to send embed for guild ${guildId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Update the voice channel name to reflect the current player count.
 * Skips the API call when the count hasn't changed to preserve the
 * Discord rate limit (2 renames per channel per 10 minutes).
 */
async function updatePlayerCountVoiceChannel(
  voiceChannel: VoiceChannel,
  guildId: string,
  counts: PlayerCounts,
  refs: GuildChannelRefs,
): Promise<void> {
  if (
    refs.lastCounts.online === counts.online &&
    refs.lastCounts.max === counts.max
  ) {
    return;
  }

  const newName = buildVoiceChannelName(counts.online, counts.max);

  try {
    const renamed = await renameVoiceChannelIfChanged(voiceChannel, newName);
    if (renamed) {
      refs.lastCounts = counts;
      log.info('status', `Updated player count to "${newName}" for guild ${guildId}`);
    }
  } catch (err) {
    log.warn(
      'status',
      `Failed to rename voice channel for guild ${guildId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ─── Per-guild update ─────────────────────────────────────────────────────────

async function updateGuildStatus(
  client: Client,
  guildId: string,
  state: StatusMessageState,
  { embed, counts }: StatusBuildResult,
): Promise<void> {
  // Use the cached channel references; provision on first call or after eviction
  let refs = channelRefCache.get(guildId);

  if (!refs) {
    const provisioned = await provisionGuildChannels(client, guildId, state);
    if (!provisioned) return;

    refs = {
      textChannel: provisioned.textChannel,
      voiceChannel: provisioned.voiceChannel,
      lastCounts: { online: -1, max: -1 }, // sentinel forces the first rename
    };
    channelRefCache.set(guildId, refs);
  }

  await sendOrUpdateEmbed(refs.textChannel, embed, guildId, state);
  await updatePlayerCountVoiceChannel(refs.voiceChannel, guildId, counts, refs);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the status embed updater.
 *
 * For every guild that has `statusEmbed.enabled = true` (or an unset config,
 * which defaults to enabled), the bot will:
 *  1. Create (or find) a private "📊 Server Status" category.
 *  2. Provision a `#server-status` text channel for the live embed.
 *  3. Provision a `👥 Players: X / Y` voice channel as a read-only counter.
 *
 * No manual channel IDs need to be configured — the bot self-provisions.
 */
export function startStatusEmbed(
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): ReturnType<typeof setInterval> | null {
  const enabledGuilds = Object.entries(guildConfigs).filter(
    ([, cfg]) => cfg.statusEmbed?.enabled !== false,
  );

  if (enabledGuilds.length === 0) {
    log.info('status', 'No guilds have statusEmbed enabled, skipping');
    return null;
  }

  const update = async (): Promise<void> => {
    let state: StatusMessageState;
    try {
      state = await loadState();
    } catch (err) {
      log.error('status', `Failed to load state: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    let statusResult: StatusBuildResult;
    try {
      statusResult = await buildStatusEmbed();
    } catch (err) {
      log.error('status', `Failed to build embed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    // Sequential: avoids concurrent writes to shared in-memory state
    for (const [guildId] of enabledGuilds) {
      try {
        await updateGuildStatus(client, guildId, state, statusResult);
      } catch (err) {
        log.error(
          'status',
          `Update failed for guild ${guildId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  };

  setTimeout(update, INITIAL_DELAY_MS);
  const timer = setInterval(update, UPDATE_INTERVAL_MS);

  log.info('status', `Status embed active for ${enabledGuilds.length} guild(s)`);
  return timer;
}
