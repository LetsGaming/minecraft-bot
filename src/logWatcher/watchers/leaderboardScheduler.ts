import path from 'path';
import type { Client } from 'discord.js';
import { loadConfig } from '../../config.js';
import { buildLeaderboard } from '../../utils/statUtils.js';
import type { BuildLeaderboardOptions } from '../../utils/statUtils.js';
import { buildLeaderboardEmbed } from '../../utils/statEmbeds.js';
import {
  takeSnapshot,
  getSnapshotClosestTo,
} from '../../utils/snapshotUtils.js';
import { loadJson, saveJson, getRootDir } from '../../utils/utils.js';
import { log } from '../../utils/logger.js';
import { getAllInstances, getServerInstance } from '../../utils/server.js';
import type { GuildConfig, LeaderboardInterval, LeaderboardScheduleState } from '../../types/index.js';

const SCHEDULE_PATH = path.resolve(
  getRootDir(),
  'data',
  'leaderboardSchedule.json',
);
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000;

const INTERVAL_MS: Record<LeaderboardInterval, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

const INTERVAL_LABELS: Record<LeaderboardInterval, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

async function loadSchedule(): Promise<LeaderboardScheduleState> {
  const data = await loadJson(SCHEDULE_PATH).catch(() => ({}));
  return (data as LeaderboardScheduleState) || {};
}

async function saveSchedule(schedule: LeaderboardScheduleState): Promise<void> {
  await saveJson(SCHEDULE_PATH, schedule);
}

interface SchedulerTimers {
  snapshotTimer: ReturnType<typeof setInterval>;
  postTimer: ReturnType<typeof setInterval>;
}

/**
 * Start the leaderboard scheduler and the hourly snapshot timer.
 */
export function startLeaderboardScheduler(
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): ReturnType<typeof setInterval> | SchedulerTimers {
  const cfg = loadConfig();
  const globalInterval = cfg.leaderboardInterval;

  // ── Snapshots: one per server instance ──
  const snapshotTimer = setInterval(async () => {
    for (const server of getAllInstances()) {
      try {
        await takeSnapshot(server);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error('snapshots', `Snapshot failed for ${server.id}: ${msg}`);
      }
    }
  }, SNAPSHOT_INTERVAL_MS);

  setTimeout(() => {
    for (const server of getAllInstances()) takeSnapshot(server).catch(() => {});
  }, 10000);

  // ── Leaderboard posting: only if any guild has it configured ──
  const hasAnyConfig = Object.values(guildConfigs).some(
    (g) => g.leaderboard?.channelId,
  );
  if (!hasAnyConfig) {
    log.info(
      'leaderboard',
      'No leaderboard channels configured, scheduler inactive (snapshots still running)',
    );
    return snapshotTimer;
  }

  const postTimer = setInterval(async () => {
    try {
      await checkAndPost(client, guildConfigs, globalInterval);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('leaderboard', `Scheduler error: ${msg}`);
    }
  }, CHECK_INTERVAL_MS);

  setTimeout(
    () => checkAndPost(client, guildConfigs, globalInterval).catch(() => {}),
    30000,
  );

  log.info(
    'leaderboard',
    `Scheduler active (snapshots + posting every ${CHECK_INTERVAL_MS / 60000}min)`,
  );
  return { snapshotTimer, postTimer };
}

async function checkAndPost(
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
  globalInterval: LeaderboardInterval,
): Promise<void> {
  const schedule = await loadSchedule();
  const now = Date.now();

  for (const [guildId, gcfg] of Object.entries(guildConfigs)) {
    const lb = gcfg.leaderboard;
    if (!lb?.channelId) continue;

    const interval = (lb.interval ?? globalInterval) as LeaderboardInterval;
    const intervalMs = INTERVAL_MS[interval];
    if (!intervalMs) {
      log.warn(
        'leaderboard',
        `Unknown interval "${interval}" for guild ${guildId}, skipping`,
      );
      continue;
    }

    const lastPost = schedule[guildId] ?? 0;
    if (now - lastPost < intervalMs) continue;

    try {
      const channel = await client.channels.fetch(lb.channelId);
      if (!channel || !('send' in channel)) {
        log.warn(
          'leaderboard',
          `Channel ${lb.channelId} not found for guild ${guildId}`,
        );
        continue;
      }

      const periodStart = now - intervalMs;
      // Use the guild's configured server, or fall back to the first instance
      const serverId = gcfg.leaderboard?.server ?? gcfg.defaultServer;
      const server = serverId ? (getServerInstance(serverId) ?? undefined) : getAllInstances()[0];
      if (!server) {
        log.warn('leaderboard', `No server instance found for guild ${guildId}, skipping`);
        continue;
      }
      const snapshot = await getSnapshotClosestTo(periodStart);

      const periodLabel = INTERVAL_LABELS[interval] ?? interval;
      let footer: string;

      const opts: BuildLeaderboardOptions = { periodLabel, server };

      if (snapshot) {
        opts.baseline = snapshot.players;
        const snapshotAge = Math.round(
          (now - snapshot.timestamp) / (60 * 60 * 1000),
        );
        footer = `${periodLabel} leaderboard · based on last ${snapshotAge}h of data`;
      } else {
        footer = `${periodLabel} leaderboard · no snapshot available, showing all-time`;
      }

      const leaderboardData = await buildLeaderboard('playtime', opts);
      const embed = buildLeaderboardEmbed(leaderboardData);
      embed.setFooter({ text: footer });

      await channel.send({ embeds: [embed] });

      schedule[guildId] = now;
      await saveSchedule(schedule);

      log.info(
        'leaderboard',
        `Posted ${interval} leaderboard for guild ${guildId}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(
        'leaderboard',
        `Failed to post for guild ${guildId}: ${msg}`,
      );
    }
  }
}
