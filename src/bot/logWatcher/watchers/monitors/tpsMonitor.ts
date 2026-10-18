import { type Client } from "discord.js";
import { log } from "@mcbot/core/utils/logger.js";
import { serverInScope } from "../../../utils/guild/guildRouter.js";
import {
  resolveGuildConfigs,
  type GuildConfigSource,
} from "../../../utils/guild/guildConfigs.js";
import { loadConfig } from "@mcbot/core/config.js";
import { createEmbed } from "../../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../../utils/embeds/embedColors.js";
import {
  alertMention,
  shouldPing,
  type AlertLevel,
} from "../../../utils/embeds/alertUtils.js";
import type { TpsResult } from "@mcbot/core/types/index.js";
import { t, runWithGuildLocale } from "@mcbot/core/utils/i18n.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import { errMsg } from "@mcbot/core/utils/error.js";

const REPEAT_MS = 5 * 60_000;
/** Below this, low TPS is an error rather than a warning. */
const SEVERE_TPS = 10;

const warned = new Map<string, number>();
const levels = new Map<string, AlertLevel>();

export interface TpsMonitorHandle {
  stop(): void;
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
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const schedule = (): void => {
    timer = setTimeout(() => {
      void checkTps().finally(() => {
        if (!stopped) schedule();
      });
    }, loadConfig().tpsPollIntervalMs);
  };

  const checkTps = async (): Promise<void> => {
    const threshold = loadConfig().tpsWarningThreshold;
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
      tps.tps1m >= threshold ? "ok" : tps.tps1m < SEVERE_TPS ? "error" : "warning";

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

  const broadcast = async (
    tps: TpsResult,
    threshold: number,
    previous: AlertLevel,
    level: AlertLevel,
  ): Promise<void> => {
    // Resolved per alert: the timer is armed once per server.
    for (const [guildId, gcfg] of Object.entries(resolveGuildConfigs(guildConfigs))) {
      const tpsAlert = gcfg.tpsAlerts;
      if (!tpsAlert?.channelId) continue;
      if (!serverInScope(tpsAlert.server, serverInstance.id, guildId)) continue;

      try {
        const channel = await client.channels.fetch(tpsAlert.channelId);
        if (!channel || !("send" in channel)) continue;

        const embed = runWithGuildLocale(guildId, () => buildTpsEmbed(tps, threshold, level));
        await channel.send({
          embeds: [embed],
          ...alertMention(tpsAlert.mentionRole, tpsAlert.mentionPolicy, previous, level),
        });
      } catch (err) {
        log.error("tps", `Alert failed: ${errMsg(err)}`);
      }
    }
  };

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
        { name: "1 min", value: tps.tps1m.toFixed(1), inline: true },
        { name: "5 min", value: tps.tps5m.toFixed(1), inline: true },
        { name: "15 min", value: tps.tps15m.toFixed(1), inline: true },
      );
    } else {
      embed.addFields({ name: "TPS", value: tps.tps1m.toFixed(1), inline: true });
      if ("mspt" in tps && tps.mspt !== undefined) {
        embed.addFields({ name: "MSPT", value: `${tps.mspt.toFixed(1)} ms`, inline: true });
      }
    }
    return embed;
  };

  schedule();

  const { tpsWarningThreshold, tpsPollIntervalMs } = loadConfig();
  log.info(
    serverInstance.id,
    `TPS monitoring active (threshold: ${tpsWarningThreshold}, interval: ${tpsPollIntervalMs / 1000}s)`,
  );
  return {
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
