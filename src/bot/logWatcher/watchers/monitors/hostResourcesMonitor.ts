/**
 * Host resources monitor: early warning before backups fill the disk.
 *
 * Polls disk usage of each instance's monitored paths (world dir + suite
 * backups; remote instances report theirs through the wrapper's `/info`)
 * and alerts each guild's downtimeAlerts channel once when usage reaches
 * `hostAlerts.diskWarnPercent` (default 90). Hysteresis like the downtime
 * alerts: the alert only re-arms after usage drops HYSTERESIS points
 * below the threshold, and a short all-clear is sent.
 *
 * Remote instances with a wrapper older than 1.2.0 (no /info host block)
 * are skipped.
 */
import { formatBytes, MS } from "@mcbot/schema";
import { type Client } from "discord.js";
import { log } from "@mcbot/core/utils/logger.js";
import {
  guildsWith,
  type GuildConfigSource,
} from "../../../utils/guild/guildConfigs.js";
import { createEmbed } from "../../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../../utils/embeds/embedColors.js";
import { tryLoadConfig } from "@mcbot/core/utils/config/configAccess.js";
import { readBackups } from "@mcbot/core/utils/server/serverAccess.js";
import { getHostResources } from "@mcbot/core/utils/server/hostResources.js";
import {
  classifyDiskUsage,
  DEFAULT_DISK_ALERT_PERCENT,
} from "@mcbot/schema/thresholds.js";
import type { DiskUsage } from "@mcbot/core/utils/server/hostResources.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { alertMention, type AlertLevel } from "../../../utils/embeds/alertUtils.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { onServerRemoved } from "../../serverCleanup.js";
import { sendToGuildChannels } from "../notifyGuilds.js";
import { startPoller, type Poller } from "../poller.js";

const CHECK_INTERVAL_MS = 5 * MS.minute; // disks fill slowly
const HYSTERESIS_PERCENT = 5;

/** serverId:path → currently in alert state */
const alertState = new Map<string, boolean>();

/** serverId → backup-age alert currently active */
const backupAlertState = new Map<string, boolean>();

onServerRemoved((serverId) => {
  for (const key of alertState.keys()) {
    if (key.startsWith(`${serverId}:`)) alertState.delete(key);
  }
  backupAlertState.delete(serverId);
});

/** Exposed for tests. */
export function _resetStateForTesting(): void {
  alertState.clear();
  backupAlertState.clear();
}

interface AlertContext {
  client: Client;
  guildConfigs: GuildConfigSource;
}

export function startHostResourcesMonitor(
  servers: ServerInstance[] | (() => ServerInstance[]),
  client: Client,
  guildConfigs: GuildConfigSource,
): Poller {
  const getServers = typeof servers === "function" ? servers : () => servers;
  const ctx: AlertContext = { client, guildConfigs };

  const poller = startPoller(
    "hostAlerts",
    async () => {
      // Read fresh each tick so /config reload applies live; a threshold of 0
      // disables a check without stopping the poller.
      const loaded = tryLoadConfig({ onError: "open" });
      const hostAlerts = loaded.ok ? loaded.config.hostAlerts : undefined;
      const threshold = hostAlerts?.diskWarnPercent ?? DEFAULT_DISK_ALERT_PERCENT;
      const backupMaxAgeHours = hostAlerts?.backupMaxAgeHours ?? 0;
      if (threshold <= 0 && backupMaxAgeHours <= 0) return;

      for (const server of getServers()) {
        try {
          if (threshold > 0) await checkServer(server, ctx, threshold);
          if (backupMaxAgeHours > 0) await checkBackupAge(server, ctx, backupMaxAgeHours);
        } catch (err) {
          log.error("hostAlerts", `Check error for ${server.id}: ${errMsg(err)}`);
        }
      }
    },
    CHECK_INTERVAL_MS,
  );

  log.info(
    "hostAlerts",
    `Disk monitor active, alerting ` +
      `${guildsWith(guildConfigs, (c) => !!c.downtimeAlerts?.channelId).length} guild(s)`,
  );
  return poller;
}

/**
 * Disk usages for one instance, one entry per *filesystem*.
 *
 * The alert is about a filesystem filling up, and the server directory and
 * the backups directory usually share one, so reporting both meant two
 * identical alerts for one disk. Deduped by mount point where the wrapper
 * names it (host-info v2); an older wrapper sends no mount point, and
 * per-path alerts are the best that can be done with what it says.
 */
async function collectUsages(server: ServerInstance): Promise<DiskUsage[]> {
  const host = await getHostResources(server.config);
  const disks = host?.disks ?? [];

  const seen = new Set<string>();
  return disks.filter((d) => {
    const mount = d.filesystem.mountPoint;
    if (mount === "") return true;
    if (seen.has(mount)) return false;
    seen.add(mount);
    return true;
  });
}

async function checkServer(
  server: ServerInstance,
  ctx: AlertContext,
  threshold: number,
): Promise<void> {
  for (const usage of await collectUsages(server)) {
    // Key on the filesystem, not the path: the alert tracks a disk, and
    // keying on the path would re-fire when the monitored dirs change.
    const key = `${server.id}:${usage.filesystem.mountPoint || usage.path}`;
    const alerted = alertState.get(key) ?? false;
    const percent = usage.filesystem.usedPercent;

    if (!alerted && percent >= threshold) {
      alertState.set(key, true);
      log.warn(
        "hostAlerts",
        `${server.id}: ${usage.path} at ${percent}% (threshold ${threshold}%)`,
      );
      const level: AlertLevel = classifyDiskUsage(percent) === "critical" ? "error" : "warning";
      await alertGuilds(ctx, server.id, ["ok", level], () => ({
        title: t("hostAlerts.diskFullTitle", { server: server.id }),
        description: t("hostAlerts.diskFull", {
          server: server.id,
          path: usage.path,
          percent,
          free: formatBytes(usage.filesystem.availableBytes),
        }),
        color: level === "error" ? EmbedColor.Error : EmbedColor.Warning,
      }));
    } else if (alerted && percent <= threshold - HYSTERESIS_PERCENT) {
      alertState.set(key, false);
      await alertGuilds(ctx, server.id, ["error", "ok"], () => ({
        title: t("hostAlerts.diskOkTitle", { server: server.id }),
        description: t("hostAlerts.diskOk", {
          server: server.id,
          path: usage.path,
          percent,
        }),
        color: EmbedColor.Success,
      }));
    }
  }
}

/**
 * Backup staleness: alert once when the newest backup exceeds the age
 * threshold, all-clear (and re-arm) as soon as a fresh backup appears.
 * Servers without the suite backup layout are skipped: no layout means
 * nothing meaningful to measure, not a stale backup.
 */
async function checkBackupAge(
  server: ServerInstance,
  ctx: AlertContext,
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
    return; // unreadable backups dir: the disk alert covers real trouble
  }
  if (newestMs === 0) return; // no backups at all: setup issue, not staleness

  const ageHours = (Date.now() - newestMs) / MS.hour;
  const alerted = backupAlertState.get(server.id) ?? false;

  if (!alerted && ageHours >= maxAgeHours) {
    backupAlertState.set(server.id, true);
    log.warn(
      "hostAlerts",
      `${server.id}: newest backup is ${ageHours.toFixed(1)}h old (threshold ${maxAgeHours}h)`,
    );
    await alertGuilds(ctx, server.id, ["ok", "error"], () => ({
      title: t("backupAlert.staleTitle", { server: server.id }),
      description: t("backupAlert.stale", {
        server: server.id,
        age: ageHours.toFixed(1),
        max: maxAgeHours,
      }),
      color: EmbedColor.Error,
    }));
  } else if (alerted && ageHours < maxAgeHours) {
    backupAlertState.set(server.id, false);
    await alertGuilds(ctx, server.id, ["error", "ok"], () => ({
      title: t("backupAlert.freshTitle", { server: server.id }),
      description: t("backupAlert.fresh", {
        server: server.id,
        age: ageHours < 1 ? "<1" : ageHours.toFixed(1),
      }),
      color: EmbedColor.Success,
    }));
  }
}

function alertGuilds(
  { client, guildConfigs }: AlertContext,
  serverId: string,
  levels: [AlertLevel, AlertLevel],
  buildEmbedOpts: () => { title: string; description: string; color: number },
): Promise<void> {
  return sendToGuildChannels(client, guildConfigs, {
    pick: (gcfg) => gcfg.downtimeAlerts,
    serverId,
    logTag: "hostAlerts",
    describe: "Failed to send alert",
    build: () => ({ embeds: [createEmbed({ ...buildEmbedOpts(), timestamp: true })] }),
    mention: (target) => alertMention(target.mentionRole, target.mentionPolicy, ...levels),
  });
}
