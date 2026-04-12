import { EmbedBuilder } from "discord.js";
import { log } from "../../utils/logger.js";

// "[time] [Server thread/INFO]: Player has made the advancement [Advancement Name]"
// "[time] [Server thread/INFO]: Player has completed the challenge [Challenge Name]"
// "[time] [Server thread/INFO]: Player has reached the goal [Goal Name]"
const ADV_REGEX = /\[.+?\].*:\s+(\w+) has (?:made the advancement|completed the challenge|reached the goal) \[(.+?)\]/;

export function registerAdvancementWatcher(logWatcher, client, guildConfigs) {
  const serverId = logWatcher.server.id;

  logWatcher.register(ADV_REGEX, async (match) => {
    const [, player, advancement] = match;

    for (const [, gcfg] of Object.entries(guildConfigs)) {
      const notif = gcfg.notifications;
      if (!notif?.channelId || !notif.events?.includes("advancement")) continue;

      try {
        const channel = await client.channels.fetch(notif.channelId);
        if (!channel) continue;

        const head = `https://mc-heads.net/avatar/${player}/32`;
        const isChallenge = match[0].includes("completed the challenge");

        const embed = new EmbedBuilder()
          .setAuthor({ name: player, iconURL: head })
          .setTitle(isChallenge ? "🏆 Challenge Complete!" : "⭐ Advancement Made!")
          .setDescription(`**${advancement}**`)
          .setColor(isChallenge ? 0xa020f0 : 0x55ff55)
          .setTimestamp();

        if (Object.keys(guildConfigs).length > 1) embed.setFooter({ text: serverId });

        await channel.send({ embeds: [embed] });
      } catch (err) {
        log.error("advancements", `Failed: ${err.message}`);
      }
    }
  });
}
