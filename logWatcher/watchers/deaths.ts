import { EmbedBuilder, type Client } from 'discord.js';
import { log } from '../../utils/logger.js';
import type { LogWatcher } from '../logWatcher.js';
import type { GuildConfig } from '../../types/index.js';

const DEATH_REGEX =
  /\[.+?\].*:\s+(\w+)\s+(was slain|was shot|was killed|drowned|burned|fell|hit the ground|went off with a bang|blew up|was blown up|tried to swim|was impaled|was squished|was pummeled|was fireballed|starved|suffocated|was poked|experienced kinetic|was doomed|walked into|was pricked|died|withered away|was stung|was obliterated|was squashed|didn't want to live|was frozen|was skewered)/i;

export function registerDeathWatcher(
  logWatcher: LogWatcher,
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): void {
  const serverId = logWatcher.server.id;

  logWatcher.register(DEATH_REGEX, async (match) => {
    const fullLine = match[0];
    const msgMatch = fullLine.match(/\]:\s+(.+)$/);
    const deathMessage = msgMatch?.[1] ?? `${match[1]} died`;
    const player = match[1]!;

    for (const [, gcfg] of Object.entries(guildConfigs)) {
      const notif = gcfg.notifications;
      if (!notif?.channelId || !notif.events?.includes('death')) continue;

      try {
        const channel = await client.channels.fetch(notif.channelId);
        if (!channel || !('send' in channel)) continue;

        const head = `https://mc-heads.net/avatar/${player}/32`;
        const embed = new EmbedBuilder()
          .setAuthor({ name: '☠️ Death', iconURL: head })
          .setDescription(deathMessage)
          .setColor(0x8b0000)
          .setTimestamp();

        if (Object.keys(guildConfigs).length > 1)
          embed.setFooter({ text: serverId });

        await channel.send({ embeds: [embed] });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error('deaths', `Failed: ${msg}`);
      }
    }
  });
}
