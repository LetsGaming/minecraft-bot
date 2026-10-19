import type { Client, EmbedBuilder } from "discord.js";
import { loadConfig } from "@mcbot/core/config.js";
import {
  buildLeaderboard,
  LEADERBOARD_STATS,
} from "@mcbot/core/utils/minecraft/statUtils.js";
import {
  isStreakStatKey,
  buildStreakLeaderboard,
} from "@mcbot/core/utils/minecraft/streakLeaderboard.js";
import { buildLeaderboardEmbed } from "../../../utils/embeds/statEmbeds.js";
import {
  takeSnapshot,
  getSnapshotClosestTo,
} from "@mcbot/core/utils/minecraft/snapshotUtils.js";
import {
  loadLeaderboardSchedule,
  recordLeaderboardPost,
} from "@mcbot/core/utils/stores/leaderboardScheduleStore.js";
import { LEADERBOARD_INTERVAL_MS } from "@mcbot/schema/stats.js";
import { MS } from "@mcbot/schema";
import { log } from "@mcbot/core/utils/logger.js";
import {
  resolveGuildConfigs,
  type GuildConfigSource,
} from "../../../utils/guild/guildConfigs.js";
import { getAllInstances, getServerInstance } from "@mcbot/core/utils/server/server.js";
import type {
  BotConfig,
  GuildConfig,
  GuildLeaderboardConfig,
  LeaderboardInterval,
} from "@mcbot/core/types/index.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import {
  DAY_CODES,
  parseScheduleTime,
  nextTimeOfDayEpoch,
  localDayOfWeek,
  localDayOfMonth,
} from "@mcbot/core/utils/time.js";
import { guildTimeZone } from "@mcbot/core/utils/config/timezones.js";
import { t, runWithGuildLocale } from "@mcbot/core/utils/i18n.js";
import { fetchSendable } from "../notifyGuilds.js";
import { startPoller, type Poller } from "../poller.js";

const SNAPSHOT_INTERVAL_MS = MS.hour;
const INITIAL_SNAPSHOT_DELAY_MS = 10 * MS.second;
const INITIAL_POST_DELAY_MS = 30 * MS.second;
/**
 * How often the post check runs. An anchored postTime needs finer than
 * hourly granularity, or a 13:00 board can land anywhere in 13:00-14:00;
 * 5 minutes costs one config read + one KV read for guilds not yet due,
 * which is negligible against re-arming a timer per guild.
 */
const POST_CHECK_INTERVAL_MS = 5 * MS.minute;

const INTERVAL_LABEL_KEYS: Record<LeaderboardInterval, string> = {
  daily: "leaderboard.periodDaily",
  weekly: "leaderboard.periodWeekly",
  monthly: "leaderboard.periodMonthly",
};

const DEFAULT_POST_DAY = "MO";
const DEFAULT_CATEGORIES = ["playtime", "mined"];
/** Discord caps embeds per message at 10. */
const MAX_EMBEDS_PER_MESSAGE = 10;

/**
 * The first anchored post moment strictly after `afterMs`, or null when
 * `postTime` is malformed (caller falls back to the legacy interval model).
 *
 * A persisted-timestamp check on a short tick, rather than a re-armed timeout
 * per guild: the scheduler re-reads the guild config on every tick, so config
 * edits apply without re-arming anything.
 */
export function nextLeaderboardRun(
  interval: LeaderboardInterval,
  postTime: string,
  postDay: string | undefined,
  tz: string,
  afterMs: number,
): number | null {
  const parsed = parseScheduleTime(postTime);
  if (!parsed) return null;

  let candidate = nextTimeOfDayEpoch(parsed.hour, parsed.minute, tz, afterMs);
  if (interval === "daily") return candidate;

  const wantDay = (postDay ?? DEFAULT_POST_DAY).toUpperCase();
  // A handful of iterations covers the worst case (a monthly target up to
  // ~31 days out); bounded so a pathological zone/DST edge can't loop forever.
  for (let i = 0; i < 40; i++) {
    if (interval === "weekly") {
      if (DAY_CODES[localDayOfWeek(candidate, tz)] === wantDay) return candidate;
    } else if (localDayOfMonth(candidate, tz) === 1) {
      return candidate;
    }
    candidate = nextTimeOfDayEpoch(parsed.hour, parsed.minute, tz, candidate);
  }
  return null;
}

/**
 * Start the snapshot poller (hourly) and the leaderboard post check. Both stop
 * with the returned handle.
 */
export function startLeaderboardScheduler(
  client: Client,
  guildConfigs: GuildConfigSource,
): Poller {
  const snapshots = startPoller(
    "snapshots",
    async () => {
      for (const server of getAllInstances()) {
        try {
          await takeSnapshot(server);
        } catch (err) {
          log.error("snapshots", `Snapshot failed for ${server.id}: ${errMsg(err)}`);
        }
      }
    },
    SNAPSHOT_INTERVAL_MS,
    { initialDelayMs: INITIAL_SNAPSHOT_DELAY_MS },
  );

  // Always armed: checkAndPost re-reads the guild block on every tick, so a
  // guild configured after startup still posts.
  const hasAnyConfig = Object.values(resolveGuildConfigs(guildConfigs)).some(
    (g) => g.leaderboard?.channelId,
  );
  if (!hasAnyConfig) {
    log.info(
      "leaderboard",
      "No leaderboard channels configured yet: scheduler armed, config re-read every check",
    );
  }

  const posts = startPoller(
    "leaderboard",
    () => checkAndPost(client, guildConfigs),
    POST_CHECK_INTERVAL_MS,
    { initialDelayMs: INITIAL_POST_DELAY_MS },
  );

  log.info(
    "leaderboard",
    `Scheduler active (snapshots every ${SNAPSHOT_INTERVAL_MS / MS.minute}min, ` +
      `post checks every ${POST_CHECK_INTERVAL_MS / MS.minute}min)`,
  );
  return {
    stop(): void {
      snapshots.stop();
      posts.stop();
    },
  };
}

/** Guilds already warned about an unusable postTime, so the warning is not repeated every check. */
const warnedPostTimes = new Set<string>();

type Schedule = Record<string, number>;

/** Whether this guild's board is due at `now`. */
function isDue(
  guildId: string,
  lb: GuildLeaderboardConfig,
  globals: BotConfig,
  interval: LeaderboardInterval,
  intervalMs: number,
  lastPost: number,
  now: number,
): boolean {
  const postTime = lb.postTime ?? globals.leaderboardPostTime;
  if (!postTime) return now - lastPost >= intervalMs;

  // Anchored: due is the first configured moment strictly after the last
  // post, so a 13:00 board doesn't fire again just because a 13:07 tick also
  // happens to be past the raw interval. `lastPost || now - intervalMs` gives
  // a never-posted guild an anchor in the past, so it doesn't wait a full
  // period on its very first run.
  const due = nextLeaderboardRun(
    interval,
    postTime,
    lb.postDay ?? globals.leaderboardPostDay,
    guildTimeZone(guildId),
    lastPost || now - intervalMs,
  );
  if (due === null) {
    const key = `${guildId}:${postTime}`;
    if (!warnedPostTimes.has(key)) {
      warnedPostTimes.add(key);
      log.warn(
        "leaderboard",
        `guild ${guildId}: invalid postTime "${postTime}", falling back to interval scheduling`,
      );
    }
    return now - lastPost >= intervalMs;
  }
  return now >= due;
}

/**
 * The servers a guild's board covers: one ID, a list (one board per server),
 * or unset for the guild's defaultServer / the first instance.
 */
function resolveServers(gcfg: GuildConfig): ServerInstance[] {
  const scope = gcfg.leaderboard?.server;
  const serverIds: Array<string | undefined> = Array.isArray(scope)
    ? scope
    : [scope ?? gcfg.defaultServer];
  return serverIds
    .map((id) => (id ? getServerInstance(id) : getAllInstances()[0]))
    .filter((s): s is ServerInstance => s != null);
}

/**
 * One batch of embeds per server, built in the guild's language. Guilds pick
 * which categories their scheduled post includes; unknown keys are skipped
 * with a log line (the validator already warned).
 */
function buildEmbeds(
  guildId: string,
  gcfg: GuildConfig,
  interval: LeaderboardInterval,
  intervalMs: number,
  servers: ServerInstance[],
  now: number,
): Promise<EmbedBuilder[][]> {
  return runWithGuildLocale(guildId, async () => {
    const periodStart = now - intervalMs;
    const periodLabel = t(INTERVAL_LABEL_KEYS[interval] ?? "leaderboard.periodDaily");
    const showServerName = servers.length > 1;
    const categories = (
      gcfg.leaderboard?.categories?.length ? gcfg.leaderboard.categories : DEFAULT_CATEGORIES
    ).slice(0, MAX_EMBEDS_PER_MESSAGE);

    const batches: EmbedBuilder[][] = [];
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
        const snapshotAge = Math.round((now - snapshot.timestamp) / MS.hour);

        // So users know it's a partial period when the bot is young.
        footer =
          snapshotAge > intervalMs / MS.hour
            ? t("leaderboard.footerBased", { period: periodLabel, hours: snapshotAge })
            : t("leaderboard.footerPartial", { period: periodLabel, hours: snapshotAge });
      } else {
        footer = t("leaderboard.footerNoSnapshot", { period: periodLabel });
      }
      if (showServerName) footer = `${server.id} · ${footer}`;

      const embeds: EmbedBuilder[] = [];
      for (const category of categories) {
        if (isStreakStatKey(category)) {
          const embed = buildLeaderboardEmbed(await buildStreakLeaderboard(category, server.id));
          // Streaks are running totals: period baselines don't apply.
          embed.setFooter({ text: t("leaderboard.streakFooter", { server: server.id }) });
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
        const embed = buildLeaderboardEmbed(await buildLeaderboard(category, opts));
        embed.setFooter({ text: footer });
        embeds.push(embed);
      }
      batches.push(embeds);
    }
    return batches;
  });
}

/**
 * End one attempt for a guild: advance its schedule and log the outcome once.
 * Every exit goes through here, failures included, so a permanently broken
 * channel (deleted, missing permissions) is retried after the normal
 * interval instead of warning on every check.
 */
function finishAttempt(
  guildId: string,
  now: number,
  level: "info" | "warn" | "error",
  message: string,
): void {
  log[level]("leaderboard", message);
  try {
    recordLeaderboardPost(guildId, now);
  } catch (err) {
    log.warn("leaderboard", `Could not save the schedule for guild ${guildId}: ${errMsg(err)}`);
  }
}

async function postGuild(
  client: Client,
  guildId: string,
  gcfg: GuildConfig,
  interval: LeaderboardInterval,
  intervalMs: number,
  now: number,
): Promise<void> {
  const channelId = gcfg.leaderboard?.channelId;
  if (!channelId) return;
  try {
    const channel = await fetchSendable(client, channelId);
    if (!channel) {
      finishAttempt(guildId, now, "warn", `Channel ${channelId} not found for guild ${guildId}`);
      return;
    }

    const servers = resolveServers(gcfg);
    if (servers.length === 0) {
      finishAttempt(
        guildId,
        now,
        "warn",
        `No server instance found for guild ${guildId}, skipping leaderboard post`,
      );
      return;
    }

    for (const embeds of await buildEmbeds(guildId, gcfg, interval, intervalMs, servers, now)) {
      if (embeds.length > 0) await channel.send({ embeds });
    }
    finishAttempt(guildId, now, "info", `Posted ${interval} leaderboard for guild ${guildId}`);
  } catch (err) {
    finishAttempt(guildId, now, "error", `Failed to post for guild ${guildId}: ${errMsg(err)}`);
  }
}

async function checkAndPost(
  client: Client,
  guildConfigs: GuildConfigSource,
): Promise<void> {
  // The global schedule defaults are read per check so config edits apply on
  // the next pass.
  const globals = loadConfig();
  const schedule: Schedule = loadLeaderboardSchedule();
  const now = Date.now();

  for (const [guildId, gcfg] of Object.entries(resolveGuildConfigs(guildConfigs))) {
    const lb = gcfg.leaderboard;
    if (!lb?.channelId) continue;

    const interval = lb.interval ?? globals.leaderboardInterval;
    const intervalMs = LEADERBOARD_INTERVAL_MS[interval];
    if (!intervalMs) {
      finishAttempt(
        guildId,
        now,
        "warn",
        `Unknown interval "${interval}" for guild ${guildId}, skipping`,
      );
      continue;
    }

    if (!isDue(guildId, lb, globals, interval, intervalMs, schedule[guildId] ?? 0, now)) {
      continue;
    }
    await postGuild(client, guildId, gcfg, interval, intervalMs, now);
  }
}
