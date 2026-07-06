/**
 * Host resources monitor — early warning before backups fill the disk.
 *
 * Polls disk usage of each instance's monitored paths (world dir + suite
 * backups; remote instances report theirs through the wrapper's `/info`)
 * and alerts each guild's downtimeAlerts channel once when usage reaches
 * `hostAlerts.diskWarnPercent` (default 90). Hysteresis like the downtime
 * alerts: the alert only re-arms after usage drops HYSTERESIS points
 * below the threshold, and a short all-clear is sent.
 *
 * Remote instances with a wrapper older than 1.2.0 (no /info host block)
 * are skipped — exactly the previous behaviour.
 */
import { type Client } from "discord.js";
import { log } from "@mcbot/core/utils/logger.js";
import { serverInScope } from "../../utils/guildRouter.js";
import { createEmbed } from "../../utils/embedUtils.js";
import { loadConfig } from "@mcbot/core/config.js";
import { readBackups } from "@mcbot/core/utils/serverAccess.js";
import {
  getDiskUsage,
  getHostResources,
  monitoredPaths,
  formatBytes,
} from "@mcbot/core/utils/hostResources.js";
import type { DiskUsage } from "@mcbot/core/utils/hostResources.js";
import { t, runWithGuildLocale } from "@mcbot/core/utils/i18n.js";
import { roleMention } from "../../utils/alertUtils.js";
import type { ServerInstance } from "@mcbot/core/utils/server.js";
import type { GuildConfig } from "@mcbot/core/types/index.js";

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // disks fill slowly
const HYSTERESIS_PERCENT = 5;
export const DEFAULT_DISK_WARN_PERCENT = 90;

/** serverId:path → currently in alert state */
const alertState = new Map<string, boolean>();

/** serverId → backup-age alert currently active */
const backupAlertState = new Map<string, boolean>();

/** Exposed for tests. */
export function _resetStateForTesting(): void {
  alertState.clear();
  backupAlertState.clear();
}

export function startHostResourcesMonitor(
  servers: ServerInstance[] | (() => ServerInstance[]),
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): ReturnType<typeof setInterval> | null {
  const getServers = typeof servers === "function" ? servers : () => servers;

  const guildsWithAlerts = Object.entries(guildConfigs).filter(
    ([, cfg]) => cfg.downtimeAlerts?.channelId,
  );

  const timer = setInterval(async () => {
    // Threshold is read fresh each tick so /config reload applies live;
    // 0 disables without restarting the timer.
    let threshold = DEFAULT_DISK_WARN_PERCENT;
    try {
      threshold =
        loadConfig().hostAlerts?.diskWarnPercent ?? DEFAULT_DISK_WARN_PERCENT;
    } catch {
      /* keep default */
    }
    let backupMaxAgeHours = 0;
    try {
      backupMaxAgeHours = loadConfig().hostAlerts?.backupMaxAgeHours ?? 0;
    } catch {
      /* keep disabled */
    }
    if (threshold <= 0 && backupMaxAgeHours <= 0) return;

    for (const server of getServers()) {
      try {
        if (threshold > 0) {
          await checkServer(server, client, guildsWithAlerts, threshold);
        }
        if (backupMaxAgeHours > 0) {
          await checkBackupAge(
            server,
            client,
            guildsWithAlerts,
            backupMaxAgeHours,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("hostAlerts", `Check error for ${server.id}: ${msg}`);
      }
    }
  }, CHECK_INTERVAL_MS);

  log.info(
    "hostAlerts",
    `Disk monitor active, alerting ${guildsWithAlerts.length} guild(s)`,
  );
  return timer;
}

/** Disk usages for one instance — df locally, wrapper /info remotely. */
async function collectUsages(server: ServerInstance): Promise<DiskUsage[]> {
  if (server.config.apiUrl) {
    const host = await getHostResources(server);
    return host?.disks ?? [];
  }
  const usages = await Promise.all(
    monitoredPaths(server).map((dir) => getDiskUsage(dir)),
  );
  return usages.filter((u): u is DiskUsage => u !== null);
}

async function checkServer(
  server: ServerInstance,
  client: Client,
  guildsWithAlerts: Array<[string, GuildConfig]>,
  threshold: number,
): Promise<void> {
  for (const usage of await collectUsages(server)) {

    const key = `${server.id}:${usage.path}`;
    const alerted = alertState.get(key) ?? false;

    if (!alerted && usage.usedPercent >= threshold) {
      alertState.set(key, true);
      log.warn(
        "hostAlerts",
        `${server.id}: ${usage.path} at ${usage.usedPercent}% (threshold ${threshold}%)`,
      );
      await broadcast(client, guildsWithAlerts, server.id, () => ({
        title: t("hostAlerts.diskFullTitle"),
        description: t("hostAlerts.diskFull", {
          server: server.id,
          path: usage.path,
          percent: usage.usedPercent,
          free: formatBytes(usage.availableBytes),
        }),
        color: 0xff5555,
      }));
    } else if (
      alerted &&
      usage.usedPercent <= threshold - HYSTERESIS_PERCENT
    ) {
      alertState.set(key, false);
      await broadcast(client, guildsWithAlerts, server.id, () => ({
        title: t("hostAlerts.diskOkTitle"),
        description: t("hostAlerts.diskOk", {
          server: server.id,
          path: usage.path,
          percent: usage.usedPercent,
        }),
        color: 0x55ff55,
      }));
    }
  }
}

/**
 * Backup staleness: alert once when the newest backup exceeds the age
 * threshold, all-clear (and re-arm) as soon as a fresh backup appears.
 * Servers without the suite backup layout are skipped — no layout means
 * nothing meaningful to measure, not a stale backup.
 */
async function checkBackupAge(
  server: ServerInstance,
  client: Client,
  guildsWithAlerts: Array<[string, GuildConfig]>,
  maxAgeHours: number,
): Promise<void> {
  // capabilities === null means "not probed" (treated as capable, same
  // as every other gate); false means the probe found no backups dir.
  if (server.capabilities && !server.capabilities.backups) return;

  let newestMs = 0;
  try {
    const summary = await readBackups(server.config);
    for (const dir of summary.dirs) {
      newestMs = Math.max(newestMs, dir.latestMtime.getTime());
    }
  } catch {
    return; // unreadable backups dir — the disk alert covers real trouble
  }
  if (newestMs === 0) return; // no backups at all — setup issue, not staleness

  const ageHours = (Date.now() - newestMs) / 3_600_000;
  const alerted = backupAlertState.get(server.id) ?? false;

  if (!alerted && ageHours >= maxAgeHours) {
    backupAlertState.set(server.id, true);
    log.warn(
      "hostAlerts",
      `${server.id}: newest backup is ${ageHours.toFixed(1)}h old (threshold ${maxAgeHours}h)`,
    );
    await broadcast(client, guildsWithAlerts, server.id, () => ({
      title: t("backupAlert.staleTitle"),
      description: t("backupAlert.stale", {
        server: server.id,
        age: ageHours.toFixed(1),
        max: maxAgeHours,
      }),
      color: 0xff5555,
    }));
  } else if (alerted && ageHours < maxAgeHours) {
    backupAlertState.set(server.id, false);
    await broadcast(client, guildsWithAlerts, server.id, () => ({
      title: t("backupAlert.freshTitle"),
      description: t("backupAlert.fresh", {
        server: server.id,
        age: ageHours < 1 ? "<1" : ageHours.toFixed(1),
      }),
      color: 0x55ff55,
    }));
  }
}

export async function broadcast(
  client: Client,
  guildsWithAlerts: Array<[string, GuildConfig]>,
  serverId: string,
  buildEmbedOpts: () => { title: string; description: string; color: number },
  logTag = "hostAlerts",
): Promise<void> {
  for (const [guildId, gcfg] of guildsWithAlerts) {
    const alertCfg = gcfg.downtimeAlerts;
    if (!alertCfg?.channelId) continue;
    if (!serverInScope(alertCfg.server, serverId, guildId)) continue;

    try {
      const channel = await client.channels.fetch(alertCfg.channelId);
      if (!channel || !("send" in channel)) continue;
      // Build per guild inside its locale context so t() calls in the
      // factory resolve this guild's language.
      const embedOpts = runWithGuildLocale(guildId, buildEmbedOpts);
      await channel.send({
        embeds: [createEmbed({ ...embedOpts, footer: { text: serverId } })],
        ...roleMention(alertCfg.mentionRole),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(logTag, `Failed to send alert: ${msg}`);
    }
  }
}
