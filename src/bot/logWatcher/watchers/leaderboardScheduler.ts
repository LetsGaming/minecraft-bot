import type { Client } from "discord.js";
import { loadConfig } from "@mcbot/core/config.js";
import {
  buildLeaderboard,
  LEADERBOARD_STATS,
} from "@mcbot/core/utils/statUtils.js";
import {
  isStreakStatKey,
  buildStreakLeaderboard,
} from "@mcbot/core/utils/streakLeaderboard.js";
import { buildLeaderboardEmbed } from "../../utils/statEmbeds.js";
import {
  takeSnapshot,
  getSnapshotClosestTo,
} from "@mcbot/core/utils/snapshotUtils.js";
import { kvGet, kvSet } from "@mcbot/core/db/kv.js";
import { log } from "@mcbot/core/utils/logger.js";
import { getAllInstances, getServerInstance } from "@mcbot/core/utils/server.js";
import type {
  GuildConfig,
  LeaderboardInterval,
  LeaderboardScheduleState,
} from "@mcbot/core/types/index.js";
import type { ServerInstance } from "@mcbot/core/utils/server.js";

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000;

const INTERVAL_MS: Record<LeaderboardInterval, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

const INTERVAL_LABELS: Record<LeaderboardInterval, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

async function loadSchedule(): Promise<LeaderboardScheduleState> {
  return kvGet<LeaderboardScheduleState>("leaderboardSchedule") ?? {};
}

async function saveSchedule(schedule: LeaderboardScheduleState): Promise<void> {
  kvSet("leaderboardSchedule", schedule);
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
        log.error("snapshots", `Snapshot failed for ${server.id}: ${msg}`);
      }
    }
  }, SNAPSHOT_INTERVAL_MS);

  setTimeout(() => {
    for (const server of getAllInstances())
      takeSnapshot(server).catch(() => {});
  }, 10000);

  // ── Leaderboard posting: only if any guild has it configured ──
  const hasAnyConfig = Object.values(guildConfigs).some(
    (g) => g.leaderboard?.channelId,
  );
  if (!hasAnyConfig) {
    log.info(
      "leaderboard",
      "No leaderboard channels configured, scheduler inactive (snapshots still running)",
    );
    return snapshotTimer;
  }

  const postTimer = setInterval(async () => {
    try {
      await checkAndPost(client, guildConfigs, globalInterval);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("leaderboard", `Scheduler error: ${msg}`);
    }
  }, CHECK_INTERVAL_MS);

  setTimeout(
    () => checkAndPost(client, guildConfigs, globalInterval).catch(() => {}),
    30000,
  );

  log.info(
    "leaderboard",
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
        "leaderboard",
        `Unknown interval "${interval}" for guild ${guildId}, skipping`,
      );
      continue;
    }

    const lastPost = schedule[guildId] ?? 0;
    if (now - lastPost < intervalMs) continue;

    try {
      const channel = await client.channels.fetch(lb.channelId);
      if (!channel || !("send" in channel)) {
        log.warn(
          "leaderboard",
          `Channel ${lb.channelId} not found for guild ${guildId}`,
        );
        continue;
      }

      const periodStart = now - intervalMs;
      // `server` may be one ID, a list (one leaderboard per server), or
      // unset → the guild's defaultServer / the first instance.
      const scope = gcfg.leaderboard?.server;
      const serverIds: Array<string | undefined> = Array.isArray(scope)
        ? scope
        : [scope ?? gcfg.defaultServer];

      const servers = serverIds
        .map((id) => (id ? getServerInstance(id) : getAllInstances()[0]))
        .filter((s): s is ServerInstance => s != null);

      if (servers.length === 0) {
        log.warn(
          "leaderboard",
          `No server instance found for guild ${guildId}, skipping leaderboard post`,
        );
        continue;
      }

      const periodLabel = INTERVAL_LABELS[interval] ?? interval;
      const showServerName = servers.length > 1;

      for (const server of servers) {
        const snapshot = await getSnapshotClosestTo(server.id, periodStart);

        let footer: string;
        const opts: {
          periodLabel: string;
          baseline?: Record<string, Record<string, number>>;
          server: ServerInstance;
        } = { periodLabel, server };

        if (snapshot) {
          opts.baseline = snapshot.players;
          const snapshotAge = Math.round(
            (now - snapshot.timestamp) / (60 * 60 * 1000),
          );

          // So users know it's a partial period when the bot is young:
          footer =
            snapshotAge > intervalMs / (60 * 60 * 1000)
              ? `${periodLabel} leaderboard · based on last ${snapshotAge}h of data`
              : `${periodLabel} leaderboard · bot tracking since ${snapshotAge}h ago (partial period)`;
        } else {
          footer = `${periodLabel} leaderboard · no snapshot available, showing all-time`;
        }
        if (showServerName) footer = `${server.id} · ${footer}`;

        // Guilds pick which categories their scheduled post includes;
        // the default matches the previous hard-coded pair. Unknown keys
        // are skipped with a log line (the validator already warned).
        const categories = (
          gcfg.leaderboard?.categories?.length
            ? gcfg.leaderboard.categories
            : ["playtime", "mined"]
        ).slice(0, 10); // Discord caps embeds per message at 10

        const embeds = [];
        for (const category of categories) {
          if (isStreakStatKey(category)) {
            const streakData = await buildStreakLeaderboard(
              category,
              server.id,
            );
            const embed = buildLeaderboardEmbed(streakData);
            // Streaks are running totals — period baselines don't apply.
            embed.setFooter({ text: `${server.id} · all-time streaks` });
            embeds.push(embed);
            continue;
          }
          if (!LEADERBOARD_STATS[category]) {
            log.warn(
              "leaderboard",
              `guild ${guildId}: unknown leaderboard category "${category}" skipped`,
            );
            continue;
          }
          const embedData = await buildLeaderboard(category, opts);
          const embed = buildLeaderboardEmbed(embedData);
          embed.setFooter({ text: footer });
          embeds.push(embed);
        }

        if (embeds.length > 0) await channel.send({ embeds });
      }

      schedule[guildId] = now;
      await saveSchedule(schedule);

      log.info(
        "leaderboard",
        `Posted ${interval} leaderboard for guild ${guildId}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("leaderboard", `Failed to post for guild ${guildId}: ${msg}`);
      // Advance the schedule timestamp even on failure so a permanently
      // broken channel (deleted, missing permissions) doesn't cause hourly
      // retry spam. The next post will be attempted after the normal interval.
      schedule[guildId] = now;
      await saveSchedule(schedule).catch(() => {});
    }
  }
}
