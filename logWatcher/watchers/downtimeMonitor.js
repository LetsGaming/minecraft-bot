import { EmbedBuilder } from "discord.js";
import { log } from "../../utils/logger.js";

const CHECK_INTERVAL_MS = 60 * 1000; // Check every 60s
const FAILURES_BEFORE_ALERT = 3; // 3 consecutive failures = 3 minutes

/**
 * Per-server tracking state.
 * - consecutiveFailures: how many checks have failed in a row
 * - alerted: whether we've already sent a downtime alert (avoids spam)
 * - suppressUntil: timestamp until which alerts are suppressed (intentional stops)
 * - lastKnownState: "online" | "offline" | null
 */
const serverStates = new Map();

function getState(serverId) {
  if (!serverStates.has(serverId)) {
    serverStates.set(serverId, {
      consecutiveFailures: 0,
      alerted: false,
      suppressUntil: 0,
      lastKnownState: null,
    });
  }
  return serverStates.get(serverId);
}

/**
 * Call this when an admin intentionally stops or restarts a server.
 * Suppresses downtime alerts for a grace period so the stop isn't flagged.
 * @param {string} serverId
 * @param {number} [graceMs=300000] - Grace period in ms (default 5 minutes)
 */
export function suppressAlerts(serverId, graceMs = 5 * 60 * 1000) {
  const state = getState(serverId);
  state.suppressUntil = Date.now() + graceMs;
  state.consecutiveFailures = 0;
  state.alerted = false;
  log.info(
    "downtime",
    `Alerts suppressed for ${serverId} (${graceMs / 1000}s grace)`,
  );
}

/**
 * Start the downtime monitor for all server instances.
 * Checks each server every 60s via RCON or screen session.
 * Alerts only after 3 consecutive failures to avoid false positives.
 * Sends a recovery notification when the server comes back online.
 */
export function startDowntimeMonitor(servers, client, guildConfigs) {
  const guildsWithAlerts = Object.entries(guildConfigs).filter(
    ([, cfg]) => cfg.downtimeAlerts?.channelId,
  );

  if (guildsWithAlerts.length === 0) {
    log.info("downtime", "No downtime alert channels configured, skipping");
    return null;
  }

  const timer = setInterval(async () => {
    for (const server of servers) {
      try {
        await checkServer(server, client, guildsWithAlerts);
      } catch (err) {
        log.error("downtime", `Check error for ${server.id}: ${err.message}`);
      }
    }
  }, CHECK_INTERVAL_MS);

  log.info(
    "downtime",
    `Monitor active for ${servers.length} server(s), alerting ${guildsWithAlerts.length} guild(s)`,
  );
  return timer;
}

async function checkServer(server, client, guildsWithAlerts) {
  const state = getState(server.id);
  const now = Date.now();

  let isOnline = false;
  try {
    isOnline = await server.isRunning();
  } catch {
    isOnline = false;
  }

  if (isOnline) {
    // ── Server is online ──
    const wasDown = state.alerted;
    state.consecutiveFailures = 0;

    if (wasDown) {
      // Server recovered — send recovery notification
      state.alerted = false;
      state.lastKnownState = "online";

      for (const [, gcfg] of guildsWithAlerts) {
        const alertCfg = gcfg.downtimeAlerts;
        if (alertCfg.server && alertCfg.server !== server.id) continue;

        await sendAlert(client, alertCfg.channelId, {
          title: "✅ Server Back Online",
          description: `**${server.id}** is back online.`,
          color: 0x55ff55,
          serverId: server.id,
        });
      }

      log.info("downtime", `${server.id} recovered`);
    }

    state.lastKnownState = "online";
  } else {
    // ── Server is offline ──
    state.consecutiveFailures++;

    // Skip if within suppression grace period (intentional stop/restart)
    if (now < state.suppressUntil) {
      state.lastKnownState = "offline";
      return;
    }

    // Only alert after threshold and only once per downtime event
    if (state.consecutiveFailures >= FAILURES_BEFORE_ALERT && !state.alerted) {
      state.alerted = true;
      state.lastKnownState = "offline";

      for (const [, gcfg] of guildsWithAlerts) {
        const alertCfg = gcfg.downtimeAlerts;
        if (alertCfg.server && alertCfg.server !== server.id) continue;

        await sendAlert(client, alertCfg.channelId, {
          title: "🔴 Server Down",
          description: `**${server.id}** appears to be offline.\nFailed ${state.consecutiveFailures} consecutive checks.`,
          color: 0xff5555,
          serverId: server.id,
        });
      }

      log.warn(
        "downtime",
        `${server.id} down (${state.consecutiveFailures} consecutive failures)`,
      );
    }
  }
}

async function sendAlert(
  client,
  channelId,
  { title, description, color, serverId },
) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color)
      .setTimestamp()
      .setFooter({ text: serverId });

    await channel.send({ embeds: [embed] });
  } catch (err) {
    log.error("downtime", `Failed to send alert: ${err.message}`);
  }
}
