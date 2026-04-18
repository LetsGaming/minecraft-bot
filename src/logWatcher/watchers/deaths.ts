import { type Client } from "discord.js";
import { createEmbed } from "../../utils/embedUtils.js";
import { log } from "../../utils/logger.js";
import type { ILogWatcher } from "../logWatcher.js";
import type { GuildConfig } from "../../types/index.js";

const DEATH_REGEX =
  /\[.+?\].*:\s+(\w+)\s+(was slain|was shot|was killed|drowned|burned|fell|hit the ground|went off with a bang|blew up|was blown up|tried to swim|was impaled|was squished|was pummeled|was fireballed|starved|suffocated|was poked|experienced kinetic|was doomed|walked into|was pricked|died|withered away|was stung|was obliterated|was squashed|didn't want to live|was frozen|was skewered)(.*)$/i;

export function registerDeathWatcher(
  logWatcher: ILogWatcher,
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): void {
  const serverId = logWatcher.server.id;

  logWatcher.register(DEATH_REGEX, async (match) => {
    const player = match[1]!;
    const verb = match[2]!;
    const rest = match[3] ?? "";
    const deathMessage = `${player} ${verb}${rest}`.trim();

    for (const [, gcfg] of Object.entries(guildConfigs)) {
      const notif = gcfg.notifications;
      if (!notif?.channelId || !notif.events?.includes("death")) continue;

      try {
        const channel = await client.channels.fetch(notif.channelId);
        if (!channel || !("send" in channel)) continue;

        const head = `https://mc-heads.net/avatar/${player}/32`;
        const embed = createEmbed({
          author: { name: "☠️ Death", iconURL: head },
          description: deathMessage,
          color: 0x8b0000,
          ...(Object.keys(guildConfigs).length > 1
            ? { footer: { text: serverId } }
            : {}),
        });

        await channel.send({ embeds: [embed] });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("deaths", `Failed: ${msg}`);
      }
    }
  });
}
