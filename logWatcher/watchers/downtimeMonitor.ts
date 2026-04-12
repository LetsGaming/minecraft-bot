import { EmbedBuilder, type Client } from 'discord.js';
import { log } from '../../utils/logger.js';
import type { ServerInstance } from '../../utils/server.js';
import type { DowntimeState, GuildConfig } from '../../types/index.js';

const CHECK_INTERVAL_MS = 60 * 1000;
const FAILURES_BEFORE_ALERT = 3;

const serverStates = new Map<string, DowntimeState>();

function getState(serverId: string): DowntimeState {
  if (!serverStates.has(serverId)) {
    serverStates.set(serverId, {
      consecutiveFailures: 0,
      alerted: false,
      suppressUntil: 0,
      lastKnownState: null,
    });
  }
  return serverStates.get(serverId)!;
}

/**
 * Call this when an admin intentionally stops or restarts a server.
 * Suppresses downtime alerts for a grace period so the stop isn't flagged.
 */
export function suppressAlerts(serverId: string, graceMs = 5 * 60 * 1000): void {
  const state = getState(serverId);
  state.suppressUntil = Date.now() + graceMs;
  state.consecutiveFailures = 0;
  state.alerted = false;
  log.info(
    'downtime',
    `Alerts suppressed for ${serverId} (${graceMs / 1000}s grace)`,
  );
}

/**
 * Start the downtime monitor for all server instances.
 */
export function startDowntimeMonitor(
  servers: ServerInstance[],
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): ReturnType<typeof setInterval> | null {
  const guildsWithAlerts = Object.entries(guildConfigs).filter(
    ([, cfg]) => cfg.downtimeAlerts?.channelId,
  );

  if (guildsWithAlerts.length === 0) {
    log.info('downtime', 'No downtime alert channels configured, skipping');
    return null;
  }

  const timer = setInterval(async () => {
    for (const server of servers) {
      try {
        await checkServer(server, client, guildsWithAlerts);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error('downtime', `Check error for ${server.id}: ${msg}`);
      }
    }
  }, CHECK_INTERVAL_MS);

  log.info(
    'downtime',
    `Monitor active for ${servers.length} server(s), alerting ${guildsWithAlerts.length} guild(s)`,
  );
  return timer;
}

async function checkServer(
  server: ServerInstance,
  client: Client,
  guildsWithAlerts: Array<[string, GuildConfig]>,
): Promise<void> {
  const state = getState(server.id);
  const now = Date.now();

  let isOnline = false;
  try {
    isOnline = await server.isRunning();
  } catch {
    isOnline = false;
  }

  if (isOnline) {
    const wasDown = state.alerted;
    state.consecutiveFailures = 0;

    if (wasDown) {
      state.alerted = false;
      state.lastKnownState = 'online';

      for (const [, gcfg] of guildsWithAlerts) {
        const alertCfg = gcfg.downtimeAlerts;
        if (!alertCfg?.channelId) continue;
        if (alertCfg.server && alertCfg.server !== server.id) continue;

        await sendAlert(client, alertCfg.channelId, {
          title: '✅ Server Back Online',
          description: `**${server.id}** is back online.`,
          color: 0x55ff55,
          serverId: server.id,
        });
      }

      log.info('downtime', `${server.id} recovered`);
    }

    state.lastKnownState = 'online';
  } else {
    state.consecutiveFailures++;

    if (now < state.suppressUntil) {
      state.lastKnownState = 'offline';
      return;
    }

    if (state.consecutiveFailures >= FAILURES_BEFORE_ALERT && !state.alerted) {
      state.alerted = true;
      state.lastKnownState = 'offline';

      for (const [, gcfg] of guildsWithAlerts) {
        const alertCfg = gcfg.downtimeAlerts;
        if (!alertCfg?.channelId) continue;
        if (alertCfg.server && alertCfg.server !== server.id) continue;

        await sendAlert(client, alertCfg.channelId, {
          title: '🔴 Server Down',
          description: `**${server.id}** appears to be offline.\nFailed ${state.consecutiveFailures} consecutive checks.`,
          color: 0xff5555,
          serverId: server.id,
        });
      }

      log.warn(
        'downtime',
        `${server.id} down (${state.consecutiveFailures} consecutive failures)`,
      );
    }
  }
}

interface AlertOptions {
  title: string;
  description: string;
  color: number;
  serverId: string;
}

async function sendAlert(
  client: Client,
  channelId: string,
  { title, description, color, serverId }: AlertOptions,
): Promise<void> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !('send' in channel)) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color)
      .setTimestamp()
      .setFooter({ text: serverId });

    await channel.send({ embeds: [embed] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('downtime', `Failed to send alert: ${msg}`);
  }
}
