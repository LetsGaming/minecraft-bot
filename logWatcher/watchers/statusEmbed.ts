import path from "path";
import { EmbedBuilder, type Client, type TextChannel } from "discord.js";
import { getAllInstances } from "../../utils/server.js";
import { loadJson, saveJson, getRootDir } from "../../utils/utils.js";
import { log } from "../../utils/logger.js";
import type { GuildConfig, StatusMessageState } from "../../types/index.js";

const STATE_PATH = path.resolve(getRootDir(), "data", "statusMessages.json");
const UPDATE_INTERVAL_MS = 60 * 1000;

/** Separator used between the base channel name and the player count. */
const CHANNEL_NAME_SEPARATOR = "|";
const CHANNEL_SUFFIX_REGEX = new RegExp(
  `\\s*\\${CHANNEL_NAME_SEPARATOR}\\s*\\d+/\\d+\\s+Players$`,
);

/** In-memory cache so we only rename when the count actually changes. */
const guildChannelCache = new Map<
  string,
  { baseName: string; lastOnline: number; lastMax: number }
>();

async function loadState(): Promise<StatusMessageState> {
  const data = await loadJson(STATE_PATH).catch(() => ({}));
  return (data as StatusMessageState) || {};
}

async function saveState(state: StatusMessageState): Promise<void> {
  await saveJson(STATE_PATH, state);
}

interface StatusBuildResult {
  embed: EmbedBuilder;
  totalOnline: number;
  totalMax: number;
}

/**
 * Build the status embed for all server instances.
 * Returns the embed together with aggregate player counts.
 */
async function buildStatusEmbed(): Promise<StatusBuildResult> {
  const instances = getAllInstances();

  interface StatusField {
    name: string;
    value: string;
    inline: boolean;
  }

  const fields: StatusField[] = [];
  let totalOnline = 0;
  let totalMax = 0;

  for (const server of instances) {
    let statusLine: string;
    let players: string[] = [];

    // Check online status first, then fetch TPS sequentially.
    // Running both in parallel on a cold RCON connection can cause getTps()
    // to fail during the connection handshake, permanently poisoning the
    // _hasTpsCommand cache so TPS is never displayed again.
    let isOnline = false;
    let tps: import("../../types/index.js").TpsResult | null = null;

    try {
      isOnline = await server.isRunning();
    } catch {
      /* offline */
    }

    if (isOnline && server.useRcon) {
      try {
        tps = await server.getTps();
      } catch {
        /* TPS unavailable */
      }
    }

    if (!isOnline) {
      statusLine = "🔴 Offline";
    } else {
      try {
        const list = await server.getList();
        const count = parseInt(String(list.playerCount), 10) || 0;
        const max = parseInt(String(list.maxPlayers), 10) || 0;
        players = list.players || [];

        totalOnline += count;
        totalMax += max;

        statusLine = `🟢 Online — ${count}/${max} players`;
      } catch {
        statusLine = "🟢 Online";
      }
    }

    let tpsLine = "";
    if (tps?.tps1m !== null && tps?.tps1m !== undefined) {
      const emoji = tps.tps1m >= 18 ? "🟢" : tps.tps1m >= 15 ? "🟡" : "🔴";
      tpsLine = `\nTPS: ${emoji} ${tps.tps1m.toFixed(1)}`;
    }

    const playerList =
      players.length > 0 ? `\nOnline: ${players.join(", ")}` : "";

    fields.push({
      name: server.id,
      value: `${statusLine}${tpsLine}${playerList}`,
      inline: instances.length <= 3,
    });
  }

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

  return { embed, totalOnline, totalMax };
}

/**
 * Derive the base channel name (without any player-count suffix).
 * Caches the result so subsequent calls are stable.
 */
function getBaseChannelName(guildId: string, currentName: string): string {
  const cached = guildChannelCache.get(guildId);
  if (cached) return cached.baseName;

  // Strip an existing suffix if the bot was restarted while a renamed channel exists
  const baseName = currentName.replace(CHANNEL_SUFFIX_REGEX, "").trim();
  return baseName;
}

/**
 * Update the channel name to reflect the current player count.
 * Only issues a Discord API call when the count has actually changed.
 */
async function updateChannelName(
  channel: TextChannel,
  guildId: string,
  totalOnline: number,
  totalMax: number,
): Promise<void> {
  const baseName = getBaseChannelName(guildId, channel.name);
  const cached = guildChannelCache.get(guildId);

  // Skip the rename if the counts haven't changed
  if (cached && cached.lastOnline === totalOnline && cached.lastMax === totalMax) return;

  const newName = `${baseName} ${CHANNEL_NAME_SEPARATOR} ${totalOnline}/${totalMax} Players`;

  try {
    await channel.setName(newName);
    guildChannelCache.set(guildId, { baseName, lastOnline: totalOnline, lastMax: totalMax });
    log.info("status", `Renamed channel to "${newName}" for guild ${guildId}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.warn("status", `Failed to rename channel: ${errMsg}`);
  }
}

/**
 * Send or update the status embed for a specific guild.
 */
async function updateGuildStatus(
  client: Client,
  guildId: string,
  channelId: string,
  state: StatusMessageState,
  statusResult: StatusBuildResult,
): Promise<void> {
  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch {
    log.warn(
      "status",
      `Channel ${channelId} not accessible for guild ${guildId}`,
    );
    return;
  }
  if (!channel || !("send" in channel)) return;

  const { embed, totalOnline, totalMax } = statusResult;
  const stored = state[guildId];

  if (stored?.messageId && "messages" in channel) {
    try {
      const msg = await channel.messages.fetch(stored.messageId);
      await msg.edit({ embeds: [embed] });
    } catch {
      log.info(
        "status",
        `Status message missing for guild ${guildId}, creating new one`,
      );

      try {
        const msg = await channel.send({ embeds: [embed] });
        state[guildId] = { channelId, messageId: msg.id };
        await saveState(state);
        log.info(
          "status",
          `Created status embed in channel ${channelId} for guild ${guildId}`,
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.error("status", `Failed to send status embed: ${errMsg}`);
        return;
      }
    }
  } else {
    try {
      const msg = await channel.send({ embeds: [embed] });
      state[guildId] = { channelId, messageId: msg.id };
      await saveState(state);
      log.info(
        "status",
        `Created status embed in channel ${channelId} for guild ${guildId}`,
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error("status", `Failed to send status embed: ${errMsg}`);
      return;
    }
  }

  // Update the channel name with the current player count
  if ("setName" in channel) {
    await updateChannelName(channel as TextChannel, guildId, totalOnline, totalMax);
  }
}

/**
 * Start the status embed updater.
 */
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
    try {
      const state = await loadState();
      // Build once, reuse for all guilds (same server data)
      const statusResult = await buildStatusEmbed();

      for (const [guildId, gcfg] of guildsWithStatus) {
        await updateGuildStatus(
          client,
          guildId,
          gcfg.statusEmbed!.channelId!,
          state,
          statusResult,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("status", `Update failed: ${msg}`);
    }
  };

  setTimeout(update, 5000);
  const timer = setInterval(update, UPDATE_INTERVAL_MS);

  log.info(
    "status",
    `Status embed active for ${guildsWithStatus.length} guild(s)`,
  );
  return timer;
}
