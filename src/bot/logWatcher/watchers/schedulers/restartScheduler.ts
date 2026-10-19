/**
 * Scheduled restarts — a wall-clock restart per server with countdown
 * warnings, the roadmap's highest-value operator item.
 *
 * Config (top level):
 *
 *   "schedules": {
 *     "<serverId>": {
 *       "restart": {
 *         "time": "04:00",              // HH:MM in the process TZ
 *         "days": ["MO","TH"],          // optional, default: every day
 *         "warnMinutes": [15, 5, 1]     // optional countdown warnings
 *       }
 *     }
 *   }
 *
 * Warnings go to the server via /say and to each guild's notifications
 * channel (event "scheduledRestart"). The restart itself takes the same
 * path as `/server restart` — the suite's smart_restart where the
 * capability probe found it — with downtime alerts suppressed around it
 * and an admin-audit entry. Timers are wall-clock scheduled with the
 * TZ-aware helpers and re-armed after each run (a fixed 24h interval
 * drifts across DST changes) and on every config reload.
 */
import { EmbedCategory } from "@mcbot/schema/embedCategories.js";
import { scheduleTimeZone } from "@mcbot/core/utils/config/timezones.js";
import { type Client } from "discord.js";
import { loadConfig } from "@mcbot/core/config.js";
import { getServerInstance } from "@mcbot/core/utils/server/server.js";
import { runScript } from "@mcbot/core/utils/server/serverAccess.js";
import { recordAdminAction } from "@mcbot/core/utils/stores/adminAudit.js";
import {
  DAY_CODES,
  parseScheduleTime,
  nextTimeOfDayEpoch,
  localDayOfWeek,
  formatTime,
} from "@mcbot/core/utils/time.js";
import { MS } from "@mcbot/schema";
import { log } from "@mcbot/core/utils/logger.js";
import { createEmbed } from "../../../utils/embeds/embedUtils.js";
import { suppressAlerts } from "../monitors/downtimeMonitor.js";
import { broadcastNotification } from "../notifyGuilds.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { announce } from "@mcbot/core/utils/minecraft/serverMessages.js";
import type {
  BotConfig,
  ServerRestartSchedule,
} from "@mcbot/core/types/index.js";
import { errMsg } from "@mcbot/core/utils/error.js";

const DEFAULT_WARN_MINUTES = [15, 5, 1];

/**
 * The next epoch at which this schedule fires: the next HH:MM in `tz` whose
 * local weekday is allowed. Exported for tests.
 *
 * The zone is the *schedule's*, not a guild's — a 04:00 restart belongs to
 * the machine's operator, and a server watched by two guilds has no guild
 * answer to give.
 */
export function nextScheduledRun(
  schedule: ServerRestartSchedule,
  tz: string,
  fromMs: number = Date.now(),
): number | null {
  const parsed = parseScheduleTime(schedule.time);
  if (!parsed) return null;

  const allowed =
    schedule.days && schedule.days.length > 0
      ? new Set(schedule.days.map((d) => d.toUpperCase()))
      : null;

  let candidate = nextTimeOfDayEpoch(parsed.hour, parsed.minute, tz, fromMs);
  for (let i = 0; i < 8; i++) {
    const dayCode = DAY_CODES[localDayOfWeek(candidate, tz)]!;
    if (!allowed || allowed.has(dayCode)) return candidate;
    candidate = nextTimeOfDayEpoch(parsed.hour, parsed.minute, tz, candidate);
  }
  return null; // days list contains no valid codes
}

// One chain of timers per server; reconcile clears + re-arms.
const timers = new Map<string, ReturnType<typeof setTimeout>[]>();

function clearServerTimers(serverId: string): void {
  for (const timer of timers.get(serverId) ?? []) clearTimeout(timer);
  timers.delete(serverId);
}

/** Exposed for tests. */
export function _resetSchedulesForTesting(): void {
  for (const id of [...timers.keys()]) clearServerTimers(id);
}

async function announceWarning(
  client: Client,
  serverId: string,
  minutes: number,
  restartAt: number,
): Promise<void> {
  const server = getServerInstance(serverId);
  if (server) {
    await announce(server, t("schedule.warnInGame", { minutes }));
  }
  await broadcastNotification(client, loadConfig().guilds, {
    serverId,
    event: "scheduledRestart",
    buildEmbed: () =>
      createEmbed({
        title: t("schedule.warnTitle", { server: serverId }),
        description: t("schedule.warn", {
          server: serverId,
          minutes,
          time: formatTime(restartAt),
        }),
        category: EmbedCategory.Server,
      }),
    logTag: "schedule",
  });
}

async function performRestart(
  client: Client,
  serverId: string,
): Promise<void> {
  const server = getServerInstance(serverId);
  if (!server) return;
  let ok = false;

  if (server.capabilities && !server.capabilities.scripts.restart) {
    log.warn(
      "schedule",
      `${serverId}: scheduled restart skipped — no restart script (suite not installed?)`,
    );
    return;
  }

  suppressAlerts(serverId);
  log.info("schedule", `Running scheduled restart for ${serverId}`);
  await recordAdminAction({
    action: "scheduled restart",
    server: serverId,
    by: "scheduler",
    byId: "scheduler",
  });

  try {
    const result = await runScript(server.config, "restart");
    ok = result.exitCode === 0;
    if (!ok) {
      log.error(
        "schedule",
        `${serverId}: restart script exited ${result.exitCode}: ${result.stderr.slice(0, 300)}`,
      );
    }
  } catch (err) {
    log.error("schedule", `${serverId}: scheduled restart failed: ${errMsg(err)}`);
  }

  await broadcastNotification(client, loadConfig().guilds, {
    serverId,
    event: "scheduledRestart",
    buildEmbed: () =>
      createEmbed({
        title: ok
          ? t("schedule.doneTitle", { server: serverId })
          : t("restart.failedTitle", { server: serverId }),
        description: ok
          ? t("schedule.done", { server: serverId })
          : t("restart.failed", { server: serverId }),
        category: ok ? EmbedCategory.Recovery : EmbedCategory.Error,
      }),
    logTag: "schedule",
  });
}

function armServer(
  client: Client,
  serverId: string,
  schedule: ServerRestartSchedule,
): void {
  clearServerTimers(serverId);

  // The schedule's own zone — see timezones.ts for why this is not the
  // guild's.
  const tz = scheduleTimeZone(serverId);
  const runAt = nextScheduledRun(schedule, tz);
  if (runAt === null) {
    log.warn(
      "schedule",
      `${serverId}: invalid restart schedule (time "${schedule.time}", days ${JSON.stringify(schedule.days ?? [])}, tz ${tz}) — not armed`,
    );
    return;
  }

  const chain: ReturnType<typeof setTimeout>[] = [];
  const warnMinutes = (schedule.warnMinutes ?? DEFAULT_WARN_MINUTES)
    .filter((m) => Number.isFinite(m) && m > 0)
    .sort((a, b) => b - a);

  for (const minutes of warnMinutes) {
    const warnAt = runAt - minutes * MS.minute;
    if (warnAt <= Date.now()) continue;
    chain.push(
      setTimeout(() => {
        announceWarning(client, serverId, minutes, runAt).catch(
          (err: unknown) => {
            log.warn("schedule", `${serverId}: warning failed: ${errMsg(err)}`);
          },
        );
      }, warnAt - Date.now()),
    );
  }

  chain.push(
    setTimeout(() => {
      performRestart(client, serverId)
        .catch((err: unknown) => {
          log.error("schedule", `${serverId}: restart run failed: ${errMsg(err)}`);
        })
        .finally(() => {
          // Re-read the schedule: it may have been edited or removed while
          // this timer was pending.
          const current = loadConfig().schedules?.[serverId]?.restart;
          if (current) armServer(client, serverId, current);
        });
    }, runAt - Date.now()),
  );

  timers.set(serverId, chain);
  log.info(
    "schedule",
    `${serverId}: next scheduled restart at ${new Date(runAt).toISOString()} (${warnMinutes.join("/") || "no"} min warnings)`,
  );
}

/**
 * Arm (or re-arm) every configured restart schedule from a fresh config.
 * Called at startup and from the config-reload reconcile, so schedule
 * edits apply live; servers that lost their schedule are disarmed.
 */
export function reconcileRestartSchedules(
  client: Client,
  config: BotConfig,
): void {
  const schedules = config.schedules ?? {};

  for (const serverId of [...timers.keys()]) {
    if (!schedules[serverId]?.restart) clearServerTimers(serverId);
  }
  for (const [serverId, entry] of Object.entries(schedules)) {
    if (!entry.restart) continue;
    if (!config.servers[serverId]) {
      log.warn(
        "schedule",
        `schedules.${serverId}: unknown server — schedule ignored`,
      );
      continue;
    }
    armServer(client, serverId, entry.restart);
  }
}
