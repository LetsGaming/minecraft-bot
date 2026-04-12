import path from "path";
import { loadConfig } from "../../config.js";
import { buildLeaderboard } from "../../utils/statUtils.js";
import {
  takeSnapshot,
  getSnapshotClosestTo,
} from "../../utils/snapshotUtils.js";
import { loadJson, saveJson, getRootDir } from "../../utils/utils.js";
import { log } from "../../utils/logger.js";

const SCHEDULE_PATH = path.resolve(
  getRootDir(),
  "data",
  "leaderboardSchedule.json",
);
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // Check every hour
const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000; // Snapshot every hour

const INTERVAL_MS = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

const INTERVAL_LABELS = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

async function loadSchedule() {
  const data = await loadJson(SCHEDULE_PATH).catch(() => ({}));
  return data || {};
}

async function saveSchedule(schedule) {
  await saveJson(SCHEDULE_PATH, schedule);
}

/**
 * Start the leaderboard scheduler and the hourly snapshot timer.
 * - Snapshots run every hour to track stat changes over time.
 * - The scheduler checks hourly whether any guild is due for a post.
 * - Posted leaderboards show only stats gained during the configured period.
 */
export function startLeaderboardScheduler(client, guildConfigs) {
  const cfg = loadConfig();
  const globalInterval = cfg.leaderboardInterval || "weekly";

  // ── Snapshots: always run so historical data is ready when needed ──
  const snapshotTimer = setInterval(async () => {
    try {
      await takeSnapshot();
    } catch (err) {
      log.error("snapshots", `Snapshot failed: ${err.message}`);
    }
  }, SNAPSHOT_INTERVAL_MS);

  // Take an initial snapshot shortly after startup
  setTimeout(() => takeSnapshot().catch(() => {}), 10000);

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
      log.error("leaderboard", `Scheduler error: ${err.message}`);
    }
  }, CHECK_INTERVAL_MS);

  // Also check once shortly after startup to catch any missed posts
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

async function checkAndPost(client, guildConfigs, globalInterval) {
  const schedule = await loadSchedule();
  const now = Date.now();

  for (const [guildId, gcfg] of Object.entries(guildConfigs)) {
    const lb = gcfg.leaderboard;
    if (!lb?.channelId) continue;

    const interval = lb.interval || globalInterval;
    const intervalMs = INTERVAL_MS[interval];
    if (!intervalMs) {
      log.warn(
        "leaderboard",
        `Unknown interval "${interval}" for guild ${guildId}, skipping`,
      );
      continue;
    }

    const lastPost = schedule[guildId] || 0;
    if (now - lastPost < intervalMs) continue;

    try {
      const channel = await client.channels.fetch(lb.channelId);
      if (!channel) {
        log.warn(
          "leaderboard",
          `Channel ${lb.channelId} not found for guild ${guildId}`,
        );
        continue;
      }

      // Find the snapshot closest to the start of this period
      const periodStart = now - intervalMs;
      const snapshot = await getSnapshotClosestTo(periodStart);

      const periodLabel = INTERVAL_LABELS[interval] || interval;
      let footer;

      const opts = { periodLabel };

      if (snapshot) {
        opts.baseline = snapshot.players;
        const snapshotAge = Math.round(
          (now - snapshot.timestamp) / (60 * 60 * 1000),
        );
        footer = `${periodLabel} leaderboard · based on last ${snapshotAge}h of data`;
      } else {
        footer = `${periodLabel} leaderboard · no snapshot available, showing all-time`;
      }

      const { embed } = await buildLeaderboard("playtime", opts);
      embed.setFooter({ text: footer });

      await channel.send({ embeds: [embed] });

      schedule[guildId] = now;
      await saveSchedule(schedule);

      log.info(
        "leaderboard",
        `Posted ${interval} leaderboard for guild ${guildId}`,
      );
    } catch (err) {
      log.error(
        "leaderboard",
        `Failed to post for guild ${guildId}: ${err.message}`,
      );
    }
  }
}
