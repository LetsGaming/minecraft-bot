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
      if (!tps || tps.tps1m === null) return;

      if (tps.tps1m < threshold) {
        const lastWarn = warned.get(serverInstance.id) || 0;
        if (Date.now() - lastWarn < 300000) return; // Don't spam — max once per 5 min
        warned.set(serverInstance.id, Date.now());

        for (const [, gcfg] of Object.entries(guildConfigs)) {
          const tpsAlert = gcfg.tpsAlerts;
          if (!tpsAlert?.channelId) continue;
          if (tpsAlert.server && tpsAlert.server !== serverInstance.id) continue;

          try {
            const channel = await client.channels.fetch(tpsAlert.channelId);
            if (!channel) continue;

            const embed = new EmbedBuilder()
              .setTitle("⚠️ Low TPS Warning")
              .setDescription(`Server TPS has dropped below ${threshold}`)
              .addFields(
                { name: "1 min", value: `${tps.tps1m.toFixed(1)}`, inline: true },
                { name: "5 min", value: `${tps.tps5m.toFixed(1)}`, inline: true },
                { name: "15 min", value: `${tps.tps15m.toFixed(1)}`, inline: true },
              )
              .setColor(tps.tps1m < 10 ? 0xff0000 : 0xffaa00)
              .setTimestamp()
              .setFooter({ text: serverInstance.id });

            await channel.send({ embeds: [embed] });
          } catch (err) {
            log.error("tps", `Alert failed: ${err.message}`);
          }
        }
      }
    } catch { /* server might be down */ }
  }, interval);

  log.info(serverInstance.id, `TPS monitoring active (threshold: ${threshold}, interval: ${interval / 1000}s)`);
  return timer;
}
