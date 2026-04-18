import { type Client } from "discord.js";
import { createEmbed } from "../../utils/embedUtils.js";
import { log } from "../../utils/logger.js";
import type { ILogWatcher } from "../logWatcher.js";
import type { GuildConfig } from "../../types/index.js";

const ADV_REGEX =
  /\[.+?\].*:\s+(\w+) has (?:made the advancement|completed the challenge|reached the goal) \[(.+?)\]/;

export function registerAdvancementWatcher(
  logWatcher: ILogWatcher,
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): void {
  const serverId = logWatcher.server.id;

  logWatcher.register(ADV_REGEX, async (match) => {
    const [, player, advancement] = match;
    if (!player || !advancement) return;

    for (const [, gcfg] of Object.entries(guildConfigs)) {
      const notif = gcfg.notifications;
      if (!notif?.channelId || !notif.events?.includes("advancement")) continue;

      try {
        const channel = await client.channels.fetch(notif.channelId);
        if (!channel || !("send" in channel)) continue;

        const head = `https://mc-heads.net/avatar/${player}/32`;
        const isChallenge = match[0].includes("completed the challenge");

        const embed = createEmbed({
          author: { name: player, iconURL: head },
          title: isChallenge
            ? "🏆 Challenge Complete!"
            : "⭐ Advancement Made!",
          description: `**${advancement}**`,
          color: isChallenge ? 0xa020f0 : 0x55ff55,
          ...(Object.keys(guildConfigs).length > 1
            ? { footer: { text: serverId } }
            : {}),
        });

        await channel.send({ embeds: [embed] });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("advancements", `Failed: ${msg}`);
      }
    }
  });
}
