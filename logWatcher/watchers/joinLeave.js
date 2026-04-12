import { EmbedBuilder } from "discord.js";
import { log } from "../../utils/logger.js";

const JOIN_REGEX = /\[.+?\].*:\s+(\w+) joined the game/;
const LEAVE_REGEX = /\[.+?\].*:\s+(\w+) left the game/;

export function registerJoinLeaveWatcher(logWatcher, client, guildConfigs) {
  const serverId = logWatcher.server.id;

  logWatcher.register(JOIN_REGEX, async (match) => {
    await notify(
      client,
      guildConfigs,
      serverId,
      match[1],
      "join",
      0x55ff55,
      "joined the server",
    );
  });

  logWatcher.register(LEAVE_REGEX, async (match) => {
    await notify(
      client,
      guildConfigs,
      serverId,
      match[1],
      "leave",
      0xff5555,
      "left the server",
    );
  });
}

async function notify(
  client,
  guildConfigs,
  serverId,
  player,
  event,
  color,
  text,
) {
  for (const [guildId, gcfg] of Object.entries(guildConfigs)) {
    const notif = gcfg.notifications;
    if (!notif?.channelId) continue;
    if (!notif.events?.includes(event)) continue;

    try {
      const channel = await client.channels.fetch(notif.channelId);
      if (!channel) continue;

      const head = `https://mc-heads.net/avatar/${player}/32`;
      const embed = new EmbedBuilder()
        .setAuthor({ name: `${player} ${text}`, iconURL: head })
        .setColor(color)
        .setTimestamp();

      if (Object.keys(guildConfigs).length > 1)
        embed.setFooter({ text: serverId });

      await channel.send({ embeds: [embed] });
    } catch (err) {
      log.error("joinLeave", `Failed: ${err.message}`);
    }
  }
}
