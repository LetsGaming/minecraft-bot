import path from "path";
import { loadConfig } from "../../config.js";
import { buildLeaderboard } from "../../utils/statUtils.js";
import { loadJson, saveJson, getRootDir } from "../../utils/utils.js";
import { log } from "../../utils/logger.js";

const SCHEDULE_PATH = path.resolve(getRootDir(), "data", "leaderboardSchedule.json");
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // Check every hour

const INTERVAL_MS = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

async function loadSchedule() {
  const data = await loadJson(SCHEDULE_PATH).catch(() => ({}));
  return data || {};
}

async function saveSchedule(schedule) {
  await saveJson(SCHEDULE_PATH, schedule);
}

/**
 * Start the leaderboard auto-poster for all guilds that have it configured.
 * Posts a playtime leaderboard at the configured interval to the configured channel.
 */
export function startLeaderboardScheduler(client, guildConfigs) {
  const cfg = loadConfig();
  const globalInterval = cfg.leaderboardInterval || "weekly";

  // Check if any guild actually has a leaderboard channel configured
  const hasAnyConfig = Object.values(guildConfigs).some(g => g.leaderboard?.channelId);
  if (!hasAnyConfig) {
    log.info("leaderboard", "No leaderboard channels configured, scheduler inactive");
    return null;
  }

  const timer = setInterval(async () => {
    try {
      await checkAndPost(client, guildConfigs, globalInterval);
    } catch (err) {
      log.error("leaderboard", `Scheduler error: ${err.message}`);
    }
  }, CHECK_INTERVAL_MS);

  // Also run once shortly after startup to catch any missed posts
  setTimeout(() => checkAndPost(client, guildConfigs, globalInterval).catch(() => {}), 30000);

  log.info("leaderboard", `Scheduler active (checking every ${CHECK_INTERVAL_MS / 60000}min)`);
  return timer;
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
      log.warn("leaderboard", `Unknown interval "${interval}" for guild ${guildId}, skipping`);
      continue;
    }

    const lastPost = schedule[guildId] || 0;
    if (now - lastPost < intervalMs) continue;

    try {
      const channel = await client.channels.fetch(lb.channelId);
      if (!channel) {
        log.warn("leaderboard", `Channel ${lb.channelId} not found for guild ${guildId}`);
        continue;
      }

      const { embed } = await buildLeaderboard("playtime");
      embed.setFooter({ text: `Auto-posted ${interval} leaderboard` });

      await channel.send({ embeds: [embed] });

      schedule[guildId] = now;
      await saveSchedule(schedule);

      log.info("leaderboard", `Posted ${interval} leaderboard for guild ${guildId}`);
    } catch (err) {
      log.error("leaderboard", `Failed to post for guild ${guildId}: ${err.message}`);
    }
  }
}
