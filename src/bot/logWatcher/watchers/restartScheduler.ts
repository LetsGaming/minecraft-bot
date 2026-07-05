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
import { type Client } from "discord.js";
import { loadConfig } from "../../../common/config.js";
import { getServerInstance } from "../../../common/utils/server.js";
import { runScript } from "../../../common/utils/serverAccess.js";
import { recordAdminAction } from "../../../common/utils/adminAudit.js";
import {
  nextTimeOfDayEpoch,
  localDayOfWeek,
  formatTime,
} from "../../../common/utils/time.js";
import { log } from "../../../common/utils/logger.js";
import { createEmbed } from "../../utils/embedUtils.js";
import { suppressAlerts } from "./downtimeMonitor.js";
import { broadcastNotification } from "./notifyGuilds.js";
import { t } from "../../../common/utils/i18n.js";
import type {
  BotConfig,
  ServerRestartSchedule,
} from "../../../common/types/index.js";

const DEFAULT_WARN_MINUTES = [15, 5, 1];
const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

/** Parse "HH:MM" → { hour, minute }, or null when malformed. */
export function parseScheduleTime(
  time: string,
): { hour: number; minute: number } | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/**
 * The next epoch at which this schedule fires: the next HH:MM in TZ whose
 * local weekday is allowed. Exported for tests.
 */
export function nextScheduledRun(
  schedule: ServerRestartSchedule,
  fromMs: number = Date.now(),
): number | null {
  const parsed = parseScheduleTime(schedule.time);
  if (!parsed) return null;

  const allowed =
    schedule.days && schedule.days.length > 0
      ? new Set(schedule.days.map((d) => d.toUpperCase()))
      : null;

  let candidate = nextTimeOfDayEpoch(parsed.hour, parsed.minute, fromMs);
  for (let i = 0; i < 8; i++) {
    const dayCode = DAY_CODES[localDayOfWeek(candidate)]!;
    if (!allowed || allowed.has(dayCode)) return candidate;
    candidate = nextTimeOfDayEpoch(parsed.hour, parsed.minute, candidate);
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
    try {
      await server.sendCommand(
        `/say ${t("schedule.warnInGame", { minutes })}`,
      );
    } catch {
      /* server may be down — the restart will bring it back anyway */
    }
  }
  await broadcastNotification(client, loadConfig().guilds, {
    serverId,
    event: "scheduledRestart",
    buildEmbed: (withServerFooter) => {
      const embed = createEmbed({
        title: t("schedule.warnTitle"),
        description: t("schedule.warn", {
          server: serverId,
          minutes,
          time: formatTime(restartAt),
        }),
        color: 0xffaa00,
      });
      if (withServerFooter) embed.setFooter({ text: serverId });
      return embed;
    },
    logTag: "schedule",
  });
}

async function performRestart(
  client: Client,
  serverId: string,
): Promise<void> {
  const server = getServerInstance(serverId);
  if (!server) return;

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
    if (result.exitCode !== 0) {
      log.error(
        "schedule",
        `${serverId}: restart script exited ${result.exitCode}: ${result.stderr.slice(0, 300)}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("schedule", `${serverId}: scheduled restart failed: ${msg}`);
  }

  await broadcastNotification(client, loadConfig().guilds, {
    serverId,
    event: "scheduledRestart",
    buildEmbed: (withServerFooter) => {
      const embed = createEmbed({
        title: t("schedule.doneTitle"),
        description: t("schedule.done", { server: serverId }),
        color: 0x55ff55,
      });
      if (withServerFooter) embed.setFooter({ text: serverId });
      return embed;
    },
    logTag: "schedule",
  });
}

function armServer(
  client: Client,
  serverId: string,
  schedule: ServerRestartSchedule,
): void {
  clearServerTimers(serverId);

  const runAt = nextScheduledRun(schedule);
  if (runAt === null) {
    log.warn(
      "schedule",
      `${serverId}: invalid restart schedule (time "${schedule.time}", days ${JSON.stringify(schedule.days ?? [])}) — not armed`,
    );
    return;
  }

  const chain: ReturnType<typeof setTimeout>[] = [];
  const warnMinutes = (schedule.warnMinutes ?? DEFAULT_WARN_MINUTES)
    .filter((m) => Number.isFinite(m) && m > 0)
    .sort((a, b) => b - a);

  for (const minutes of warnMinutes) {
    const warnAt = runAt - minutes * 60_000;
    if (warnAt <= Date.now()) continue;
    chain.push(
      setTimeout(() => {
        announceWarning(client, serverId, minutes, runAt).catch(
          (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            log.warn("schedule", `${serverId}: warning failed: ${msg}`);
          },
        );
      }, warnAt - Date.now()),
    );
  }

  chain.push(
    setTimeout(() => {
      performRestart(client, serverId)
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          log.error("schedule", `${serverId}: restart run failed: ${msg}`);
        })
        .finally(() => {
          // Wall-clock rescheduling after each run — see module docs.
          armServer(client, serverId, schedule);
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
