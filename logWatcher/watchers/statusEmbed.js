import path from "path";
import { EmbedBuilder } from "discord.js";
import { getAllInstances } from "../../utils/server.js";
import { loadConfig } from "../../config.js";
import { loadJson, saveJson, getRootDir } from "../../utils/utils.js";
import { log } from "../../utils/logger.js";

const STATE_PATH = path.resolve(getRootDir(), "data", "statusMessages.json");
const UPDATE_INTERVAL_MS = 60 * 1000; // Update every 60 seconds

/**
 * Load stored message references per guild.
 * Structure: { guildId: { channelId, messageId } }
 */
async function loadState() {
  const data = await loadJson(STATE_PATH).catch(() => ({}));
  return data || {};
}

async function saveState(state) {
  await saveJson(STATE_PATH, state);
}

/**
 * Build the status embed for all server instances.
 */
async function buildStatusEmbed() {
  const instances = getAllInstances();
  const fields = [];

  for (const server of instances) {
    let statusLine;
    let players = [];

    try {
      const running = await server.isRunning();
      if (!running) {
        statusLine = "🔴 Offline";
      } else {
        const list = await server.getList();
        const count = list.playerCount || "0";
        const max = list.maxPlayers || "?";
        players = list.players || [];
        statusLine = `🟢 Online — ${count}/${max} players`;
      }
    } catch {
      statusLine = "⚪ Unknown";
    }

    let tpsLine = "";
    if (server.useRcon) {
      try {
        const tps = await server.getTps();
        if (tps?.tps1m !== null && tps?.tps1m !== undefined) {
          const emoji = tps.tps1m >= 18 ? "🟢" : tps.tps1m >= 15 ? "🟡" : "🔴";
          tpsLine = `\nTPS: ${emoji} ${tps.tps1m.toFixed(1)}`;
        }
      } catch {
        /* server might not support tps */
      }
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

  return embed;
}

/**
 * Send or update the status embed for a specific guild.
 * If the stored message is gone, sends a new one and saves the reference.
 */
async function updateGuildStatus(client, guildId, channelId, state) {
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
  if (!channel) return;

  const embed = await buildStatusEmbed();
  const stored = state[guildId];

  // Try to edit the existing message
  if (stored?.messageId) {
    try {
      const msg = await channel.messages.fetch(stored.messageId);
      await msg.edit({ embeds: [embed] });
      return;
    } catch {
      // Message was deleted or not found — send a new one
      log.info(
        "status",
        `Status message missing for guild ${guildId}, creating new one`,
      );
    }
  }

  // Send a new message and store the reference
  try {
    const msg = await channel.send({ embeds: [embed] });
    state[guildId] = { channelId, messageId: msg.id };
    await saveState(state);
    log.info(
      "status",
      `Created status embed in channel ${channelId} for guild ${guildId}`,
    );
  } catch (err) {
    log.error("status", `Failed to send status embed: ${err.message}`);
  }
}

/**
 * Start the status embed updater.
 * Requires guild config with `statusEmbed.channelId`.
 * The bot sends a message once, then edits it on interval — no manual setup needed.
 */
export function startStatusEmbed(client, guildConfigs) {
  const guildsWithStatus = Object.entries(guildConfigs).filter(
    ([, cfg]) => cfg.statusEmbed?.channelId,
  );

  if (guildsWithStatus.length === 0) {
    log.info("status", "No status embed channels configured, skipping");
    return null;
  }

  const update = async () => {
    try {
      const state = await loadState();
      for (const [guildId, gcfg] of guildsWithStatus) {
        await updateGuildStatus(
          client,
          guildId,
          gcfg.statusEmbed.channelId,
          state,
        );
      }
    } catch (err) {
      log.error("status", `Update failed: ${err.message}`);
    }
  };

  // Initial update shortly after startup
  setTimeout(update, 5000);

  // Then update on interval
  const timer = setInterval(update, UPDATE_INTERVAL_MS);

  log.info(
    "status",
    `Status embed active for ${guildsWithStatus.length} guild(s)`,
  );
  return timer;
}
