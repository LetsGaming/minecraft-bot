import { EmbedBuilder } from "discord.js";
import { log } from "../../utils/logger.js";

const START_REGEX = /\[.+?\].*:\s+Done \([\d.]+s\)!/;
const STOP_REGEX = /\[.+?\].*:\s+Stopping server/;

let startTimes = new Map(); // serverId -> Date

export function registerServerEventWatcher(logWatcher, client, guildConfigs) {
  const serverId = logWatcher.server.id;

  logWatcher.register(START_REGEX, async () => {
    startTimes.set(serverId, new Date());
    await notifyEvent(
      client,
      guildConfigs,
      serverId,
      "start",
      "🟢 Server Started",
      0x55ff55,
      "Server is now online and ready for players.",
    );
  });

  logWatcher.register(STOP_REGEX, async () => {
    let uptimeMsg = "";
    const started = startTimes.get(serverId);
    if (started) {
      const uptime = Math.floor((Date.now() - started.getTime()) / 1000);
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      uptimeMsg = `\nUptime: ${h}h ${m}m`;
      startTimes.delete(serverId);
    }
    await notifyEvent(
      client,
      guildConfigs,
      serverId,
      "stop",
      "🔴 Server Stopped",
      0xff5555,
      `Server is shutting down.${uptimeMsg}`,
    );
  });
}

async function notifyEvent(
  client,
  guildConfigs,
  serverId,
  event,
  title,
  color,
  description,
) {
  for (const [, gcfg] of Object.entries(guildConfigs)) {
    const notif = gcfg.notifications;
    if (!notif?.channelId || !notif.events?.includes(event)) continue;

    try {
      const channel = await client.channels.fetch(notif.channelId);
      if (!channel) continue;

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setTimestamp();

      if (Object.keys(guildConfigs).length > 1)
        embed.setFooter({ text: serverId });

      await channel.send({ embeds: [embed] });
    } catch (err) {
      log.error("serverEvents", `Failed: ${err.message}`);
    }
  }
}
