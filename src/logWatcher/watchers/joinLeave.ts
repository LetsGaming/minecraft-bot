import { type Client } from 'discord.js';
import { createEmbed } from '../../utils/embedUtils.js';
import { log } from '../../utils/logger.js';
import type { ILogWatcher } from '../logWatcher.js';
import type { GuildConfig } from '../../types/index.js';

const JOIN_REGEX = /\[.+?\].*:\s+(\w+) joined the game/;
const LEAVE_REGEX = /\[.+?\].*:\s+(\w+) left the game/;

export function registerJoinLeaveWatcher(
  logWatcher: ILogWatcher,
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): void {
  const serverId = logWatcher.server.id;

  logWatcher.register(JOIN_REGEX, async (match) => {
    await notify(
      client,
      guildConfigs,
      serverId,
      match[1]!,
      'join',
      0x55ff55,
      'joined the server',
    );
  });

  logWatcher.register(LEAVE_REGEX, async (match) => {
    await notify(
      client,
      guildConfigs,
      serverId,
      match[1]!,
      'leave',
      0xff5555,
      'left the server',
    );
  });
}

async function notify(
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
  serverId: string,
  player: string,
  event: string,
  color: number,
  text: string,
): Promise<void> {
  for (const [, gcfg] of Object.entries(guildConfigs)) {
    const notif = gcfg.notifications;
    if (!notif?.channelId) continue;
    if (!notif.events?.includes(event)) continue;

    try {
      const channel = await client.channels.fetch(notif.channelId);
      if (!channel || !('send' in channel)) continue;

      const head = `https://mc-heads.net/avatar/${player}/32`;
      const embed = createEmbed({
        author: { name: `${player} ${text}`, iconURL: head },
        color,
        ...(Object.keys(guildConfigs).length > 1 ? { footer: { text: serverId } } : {}),
      });

      await channel.send({ embeds: [embed] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('joinLeave', `Failed: ${msg}`);
    }
  }
}
