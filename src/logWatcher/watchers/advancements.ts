import { type Client } from "discord.js";
import { createPlayerEmbed } from "../../utils/embedUtils.js";
import type { ILogWatcher } from "../logWatcher.js";
import type { GuildConfig } from "../../types/index.js";
import { broadcastNotification, PLAYER_NAME } from "./notifyGuilds.js";

// M-01: use PLAYER_NAME (not \w+) so Bedrock players with "."-prefixed
// names get advancement notifications too.
const ADV_REGEX = new RegExp(
  String.raw`\[.+?\].*:\s+(${PLAYER_NAME}) has (?:made the advancement|completed the challenge|reached the goal) \[(.+?)\]`,
);

export function registerAdvancementWatcher(
  logWatcher: ILogWatcher,
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): void {
  const serverId = logWatcher.server.id;

  logWatcher.register(ADV_REGEX, async (match) => {
    const [, player, advancement] = match;
    if (!player || !advancement) return;

    const isChallenge = match[0].includes("completed the challenge");

    await broadcastNotification(client, guildConfigs, {
      serverId,
      event: "advancement",
      logTag: "advancements",
      buildEmbed: (withServerFooter) =>
        createPlayerEmbed(player, {
          title: isChallenge ? `✨ Completed challenge` : `⭐ Made advancement`,
          description: `**${advancement}**`,
          color: isChallenge ? 0xa020f0 : 0x55ff55,
          ...(withServerFooter ? { footer: { text: serverId } } : {}),
        }),
    });
  });
}
