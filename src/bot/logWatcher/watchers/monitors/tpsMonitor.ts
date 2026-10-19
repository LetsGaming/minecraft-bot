import { type Client } from "discord.js";
import { log } from "@mcbot/core/utils/logger.js";
import { type GuildConfigSource } from "../../../utils/guild/guildConfigs.js";
import { tryLoadConfig } from "@mcbot/core/utils/config/configAccess.js";
import { createEmbed } from "../../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../../utils/embeds/embedColors.js";
import {
  alertMention,
  shouldPing,
  type AlertLevel,
} from "../../../utils/embeds/alertUtils.js";
import type { TpsResult } from "@mcbot/core/types/index.js";
import { t } from "@mcbot/core/utils/i18n.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import { classifyTps, DEFAULT_TPS_ALERT_THRESHOLD, MS } from "@mcbot/schema";
import { onServerRemoved } from "../../serverCleanup.js";
import { sendToGuildChannels } from "../notifyGuilds.js";
import { startPoller } from "../poller.js";

const REPEAT_MS = 5 * MS.minute;
const FALLBACK_POLL_INTERVAL_MS = MS.minute;

const warned = new Map<string, number>();
const levels = new Map<string, AlertLevel>();

onServerRemoved((serverId) => {
  warned.delete(serverId);
  levels.delete(serverId);
});

export interface TpsMonitorHandle {
  stop(): void;
}

interface TpsSettings {
  threshold: number;
  intervalMs: number;
}

function readSettings(): TpsSettings {
  const loaded = tryLoadConfig({ onError: "open" });
  if (!loaded.ok) {
    return {
      threshold: DEFAULT_TPS_ALERT_THRESHOLD,
      intervalMs: FALLBACK_POLL_INTERVAL_MS,
    };
  }
  return {
    threshold: loaded.config.tpsWarningThreshold,
    intervalMs: loaded.config.tpsPollIntervalMs,
  };
}

/**
 * Poll a server's TPS and alert when it drops below the warning threshold.
 * The threshold and the poll interval are read from the live config on every
 * tick, so edits apply without a restart.
 */
export function startTpsMonitor(
  serverInstance: ServerInstance,
  client: Client,
  guildConfigs: GuildConfigSource,
): TpsMonitorHandle | null {
  const checkTps = async (): Promise<void> => {
    const { threshold } = readSettings();
    let tps: Awaited<ReturnType<ServerInstance["getTps"]>>;
    try {
      tps = await serverInstance.getTps();
    } catch {
      return; // server might be down; the downtime monitor reports that
    }
    if (!tps || tps.tps1m === null) return;

    const id = serverInstance.id;
    const previous = levels.get(id) ?? "ok";
    const level: AlertLevel =
      tps.tps1m >= threshold
        ? "ok"
        : classifyTps(tps.tps1m) === "critical"
          ? "error"
          : "warning";

    if (level === "ok") {
      if (previous === "ok") return;
      levels.set(id, "ok");
      warned.delete(id);
      await broadcast(tps, threshold, previous, level);
      return;
    }

    // A repeat waits out the repeat interval; a rise in severity does not.
    const lastWarn = warned.get(id) ?? 0;
    if (!shouldPing(previous, level) && Date.now() - lastWarn < REPEAT_MS) return;
    warned.set(id, Date.now());
    levels.set(id, level);
    await broadcast(tps, threshold, previous, level);
  };

  const broadcast = (
    tps: TpsResult,
    threshold: number,
    previous: AlertLevel,
    level: AlertLevel,
  ): Promise<void> =>
    // Resolved per alert: the poller is armed once per server.
    sendToGuildChannels(client, guildConfigs, {
      pick: (gcfg) => gcfg.tpsAlerts,
      serverId: serverInstance.id,
      logTag: "tps",
      describe: "Alert failed",
      build: () => ({ embeds: [buildTpsEmbed(tps, threshold, level)] }),
      mention: (target) =>
        alertMention(target.mentionRole, target.mentionPolicy, previous, level),
    });

  const buildTpsEmbed = (tps: TpsResult, threshold: number, level: AlertLevel) => {
    const server = serverInstance.id;
    const embed =
      level === "ok"
        ? createEmbed({
            title: t("tps.recoveredTitle", { server }),
            description: t("tps.recovered", { threshold }),
            color: EmbedColor.Success,
            timestamp: true,
          })
        : createEmbed({
            title: t("tps.lowTitle", { server }),
            description: t("tps.low", { threshold }),
            color: level === "error" ? EmbedColor.Error : EmbedColor.Warning,
            timestamp: true,
          });

    if (tps.tps1m === null) return embed;
    if ("tps5m" in tps && tps.tps5m !== undefined) {
      embed.addFields(
        { name: t("watchers.tpsWindow1m"), value: tps.tps1m.toFixed(1), inline: true },
        { name: t("watchers.tpsWindow5m"), value: tps.tps5m.toFixed(1), inline: true },
        { name: t("watchers.tpsWindow15m"), value: tps.tps15m.toFixed(1), inline: true },
      );
    } else {
      embed.addFields({ name: "TPS", value: tps.tps1m.toFixed(1), inline: true });
      if ("mspt" in tps && tps.mspt !== undefined) {
        embed.addFields({ name: "MSPT", value: `${tps.mspt.toFixed(1)} ms`, inline: true });
      }
    }
    return embed;
  };

  const poller = startPoller("tps", checkTps, () => readSettings().intervalMs);

  const { threshold, intervalMs } = readSettings();
  log.info(
    serverInstance.id,
    `TPS monitoring active (threshold: ${threshold}, interval: ${intervalMs / 1000}s)`,
  );
  return poller;
}
