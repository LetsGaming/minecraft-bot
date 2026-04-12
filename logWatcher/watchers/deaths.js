import { EmbedBuilder } from "discord.js";
import { log } from "../../utils/logger.js";

// Minecraft death messages always contain a player name followed by a death reason
// Common patterns: "Player was slain by Zombie", "Player fell from a high place", etc.
const DEATH_REGEX = /\[.+?\].*:\s+(\w+)\s+(was slain|was shot|was killed|drowned|burned|fell|hit the ground|went off with a bang|blew up|was blown up|tried to swim|was impaled|was squished|was pummeled|was fireballed|starved|suffocated|was poked|experienced kinetic|was doomed|walked into|was pricked|died|withered away|was stung|was obliterated|was squashed|didn't want to live|was frozen|was skewered)/i;

export function registerDeathWatcher(logWatcher, client, guildConfigs) {
  const serverId = logWatcher.server.id;

  logWatcher.register(DEATH_REGEX, async (match) => {
    const fullLine = match[0];
    // Extract the full death message from the log line
    const msgMatch = fullLine.match(/\]:\s+(.+)$/);
    const deathMessage = msgMatch ? msgMatch[1] : `${match[1]} died`;
    const player = match[1];

    for (const [, gcfg] of Object.entries(guildConfigs)) {
      const notif = gcfg.notifications;
      if (!notif?.channelId || !notif.events?.includes("death")) continue;

      try {
        const channel = await client.channels.fetch(notif.channelId);
        if (!channel) continue;

        const head = `https://mc-heads.net/avatar/${player}/32`;
        const embed = new EmbedBuilder()
          .setAuthor({ name: "☠️ Death", iconURL: head })
          .setDescription(deathMessage)
          .setColor(0x8b0000)
          .setTimestamp();

        if (Object.keys(guildConfigs).length > 1) embed.setFooter({ text: serverId });

        await channel.send({ embeds: [embed] });
      } catch (err) {
        log.error("deaths", `Failed: ${err.message}`);
      }
    }
  });
}
