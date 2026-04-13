import path from "path";
import { EmbedBuilder, type Client, type TextChannel } from "discord.js";
import { getAllInstances } from "../../utils/server.js";
import { loadJson, saveJson, getRootDir } from "../../utils/utils.js";
import { log } from "../../utils/logger.js";
import type {
  GuildConfig,
  StatusMessageState,
  TpsResult,
} from "../../types/index.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const STATE_PATH = path.resolve(getRootDir(), "data", "statusMessages.json");
const UPDATE_INTERVAL_MS = 60 * 1_000;
const INITIAL_DELAY_MS = 5_000;

/**
 * Discord text channel name constraints:
 * - Max 100 characters
 * - Only lowercase letters, numbers, and hyphens (no unicode, spaces, or slashes)
 *
 * Because these restrictions make it impossible to reliably append a suffix to
 * an arbitrary user-defined base name, the channel is treated as a dedicated
 * counter and its name is fully managed by the bot in the format:
 *   "players-<online>-of-<max>"
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlayerCounts {
  online: number;
  max: number;
}

interface StatusBuildResult {
  embed: EmbedBuilder;
  counts: PlayerCounts;
}

interface ChannelCacheEntry {
  lastCounts: PlayerCounts;
}

// ─── State ────────────────────────────────────────────────────────────────────

/**
 * Per-guild cache so we only issue a Discord rename API call when player
 * counts actually change. Keyed by guild ID.
 */
const channelCache = new Map<string, ChannelCacheEntry>();

// ─── Persistence ──────────────────────────────────────────────────────────────

async function loadState(): Promise<StatusMessageState> {
  const data = await loadJson(STATE_PATH).catch(() => ({}));
  return (data as StatusMessageState) ?? {};
}

async function saveState(state: StatusMessageState): Promise<void> {
  await saveJson(STATE_PATH, state);
}

// ─── Channel name helpers ─────────────────────────────────────────────────────

/**
 * Build the full channel name from player counts.
 * The channel is fully owned by the bot — no user-defined base name is
 * preserved, because Discord text channels forbid the unicode/spaces that
 * most human-readable names contain.
 *
 * Example: online=5, max=20 → "players-5-of-20"
 */
function buildChannelName(counts: PlayerCounts): string {
  return `_${counts.online}-of-${counts.max}`;
}

// ─── Embed builder ────────────────────────────────────────────────────────────

function buildTpsLine(tps: TpsResult | null): string {
  if (tps?.tps1m == null) return "";
  const emoji = tps.tps1m >= 18 ? "🟢" : tps.tps1m >= 15 ? "🟡" : "🔴";
  return `\nTPS: ${emoji} ${tps.tps1m.toFixed(1)}`;
}

function buildPlayerListLine(players: string[]): string {
  return players.length > 0 ? `\nOnline: ${players.join(", ")}` : "";
}

async function buildServerField(
  server: ReturnType<typeof getAllInstances>[number],
  isInline: boolean,
): Promise<{
  field: { name: string; value: string; inline: boolean };
  counts: PlayerCounts;
}> {
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
      field: { name: server.id, value: "🔴 Offline", inline: isInline },
      counts,
    };
  }

  let statusLine = "🟢 Online";

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

    if (result.status === "fulfilled") {
      total.online += result.value.counts.online;
      total.max += result.value.counts.max;
      return result.value.field;
    }
    // Fulfilled failures are already handled inside buildServerField;
    // this branch only fires if the function itself throws unexpectedly.
    return {
      name: instanceId,
      value: "⚠️ Error fetching status",
      inline: isInline,
    };
  });

  const embed = new EmbedBuilder()
    .setTitle("📊 Server Status")
    .setColor(0x00bfff)
    .setTimestamp()
    .setFooter({ text: "Updates every 60s" });

  if (fields.length > 0) {
    embed.addFields(fields);
  } else {
    embed.setDescription("No servers configured.");
  }

  return { embed, counts: total };
}

// ─── Channel rename ───────────────────────────────────────────────────────────

async function updateChannelName(
  channel: TextChannel,
  guildId: string,
  counts: PlayerCounts,
): Promise<void> {
  const cached = channelCache.get(guildId);

  if (
    cached &&
    cached.lastCounts.online === counts.online &&
    cached.lastCounts.max === counts.max
  ) {
    return;
  }

  const newName = buildChannelName(counts);

  try {
    await channel.setName(newName);
    channelCache.set(guildId, { lastCounts: counts });
    log.info("status", `Renamed channel to "${newName}" for guild ${guildId}`);
  } catch (err) {
    log.warn(
      "status",
      `Failed to rename channel: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ─── Per-guild update ─────────────────────────────────────────────────────────

async function sendOrUpdateEmbed(
  channel: TextChannel,
  embed: EmbedBuilder,
  guildId: string,
  channelId: string,
  state: StatusMessageState,
): Promise<void> {
  const stored = state[guildId];

  if (stored?.messageId) {
    try {
      const msg = await channel.messages.fetch(stored.messageId);
      await msg.edit({ embeds: [embed] });
      return;
    } catch {
      log.info(
        "status",
        `Status message missing for guild ${guildId}, creating new one`,
      );
    }
  }

  try {
    const msg = await channel.send({ embeds: [embed] });
    state[guildId] = { channelId, messageId: msg.id };
    await saveState(state);
    log.info(
      "status",
      `Created status embed in channel ${channelId} for guild ${guildId}`,
    );
  } catch (err) {
    log.error(
      "status",
      `Failed to send status embed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function updateGuildStatus(
  client: Client,
  guildId: string,
  channelId: string,
  state: StatusMessageState,
  { embed, counts }: StatusBuildResult,
): Promise<void> {
  let channel: Awaited<ReturnType<typeof client.channels.fetch>>;

  try {
    channel = await client.channels.fetch(channelId);
  } catch {
    log.warn(
      "status",
      `Channel ${channelId} not accessible for guild ${guildId}`,
    );
    return;
  }

  // Narrow to a text channel that supports sending and renaming.
  if (!channel || !("send" in channel) || !("setName" in channel)) return;
  const textChannel = channel as TextChannel;

  await sendOrUpdateEmbed(textChannel, embed, guildId, channelId, state);
  await updateChannelName(textChannel, guildId, counts);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function startStatusEmbed(
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): ReturnType<typeof setInterval> | null {
  const guildsWithStatus = Object.entries(guildConfigs).filter(
    ([, cfg]) => cfg.statusEmbed?.channelId,
  );

  if (guildsWithStatus.length === 0) {
    log.info("status", "No status embed channels configured, skipping");
    return null;
  }

  const update = async (): Promise<void> => {
    // Load state fresh each cycle and build the embed once for all guilds.
    let state: StatusMessageState;
    try {
      state = await loadState();
    } catch (err) {
      log.error(
        "status",
        `Failed to load state: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    let statusResult: StatusBuildResult;
    try {
      statusResult = await buildStatusEmbed();
    } catch (err) {
      log.error(
        "status",
        `Failed to build embed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    // Update guilds sequentially to avoid concurrent writes to shared state.
    for (const [guildId, cfg] of guildsWithStatus) {
      try {
        await updateGuildStatus(
          client,
          guildId,
          cfg.statusEmbed!.channelId!,
          state,
          statusResult,
        );
      } catch (err) {
        log.error(
          "status",
          `Update failed for guild ${guildId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  };

  setTimeout(update, INITIAL_DELAY_MS);
  const timer = setInterval(update, UPDATE_INTERVAL_MS);

  log.info(
    "status",
    `Status embed active for ${guildsWithStatus.length} guild(s)`,
  );
  return timer;
}
