import { EmbedBuilder } from "discord.js";
import { log } from "../../utils/logger.js";
import { loadConfig } from "../../config.js";

const warned = new Map(); // serverId -> last warning timestamp

export function startTpsMonitor(serverInstance, client, guildConfigs) {
  const cfg = loadConfig();
  const interval = cfg.tpsPollIntervalMs || 60000;
  const threshold = cfg.tpsWarningThreshold || 15;

  if (!serverInstance.useRcon) {
    log.info(serverInstance.id, "TPS monitoring skipped (requires RCON)");
    return null;
  }

  const timer = setInterval(async () => {
    try {
      const tps = await serverInstance.getTps();

      // Robust check: Ensure tps1m is a real number before proceeding
      if (!tps || typeof tps.tps1m !== "number" || isNaN(tps.tps1m)) return;

      if (tps.tps1m < threshold) {
        const lastWarn = warned.get(serverInstance.id) || 0;
        if (Date.now() - lastWarn < 300000) return;
        warned.set(serverInstance.id, Date.now());

        // Destructure and provide defaults to prevent .toFixed() from crashing
        const { tps1m, tps5m, tps15m } = tps;
        const safe1m = tps1m.toFixed(1);
        const safe5m = typeof tps5m === "number" ? tps5m.toFixed(1) : safe1m;
        const safe15m = typeof tps15m === "number" ? tps15m.toFixed(1) : safe1m;

        for (const [, gcfg] of Object.entries(guildConfigs)) {
          const tpsAlert = gcfg.tpsAlerts;
          if (!tpsAlert?.channelId) continue;
          if (tpsAlert.server && tpsAlert.server !== serverInstance.id)
            continue;

          try {
            const channel = await client.channels.fetch(tpsAlert.channelId);
            if (!channel) continue;

            const embed = new EmbedBuilder()
              .setTitle("⚠️ Low TPS Warning")
              .setDescription(
                `Server **${serverInstance.id}** TPS has dropped below ${threshold}`,
              )
              .addFields(
                { name: "1 min", value: safe1m, inline: true },
                { name: "5 min", value: safe5m, inline: true },
                { name: "15 min", value: safe15m, inline: true },
              )
              .setColor(tps1m < 10 ? 0xff0000 : 0xffaa00)
              .setTimestamp()
              .setFooter({ text: serverInstance.id });

            await channel.send({ embeds: [embed] });
          } catch (err) {
            log.error("tps", `Alert failed: ${err.message}`);
          }
        }
      }
    } catch (err) {
      // Log the error so you know if RCON is timing out
      log.error(
        "tps",
        `Monitor loop error for ${serverInstance.id}: ${err.message}`,
      );
    }
  }, interval);

  log.info(
    serverInstance.id,
    `TPS monitoring active (threshold: ${threshold}, interval: ${interval / 1000}s)`,
  );
  return timer;
}
