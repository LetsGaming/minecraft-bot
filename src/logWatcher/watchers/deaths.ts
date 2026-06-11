import { type Client } from "discord.js";
import { createPlayerEmbed } from "../../utils/embedUtils.js";
import type { ILogWatcher } from "../logWatcher.js";
import type { GuildConfig } from "../../types/index.js";
import { broadcastNotification, PLAYER_NAME } from "./notifyGuilds.js";

// M-01: use PLAYER_NAME (not \w+) so Bedrock players with "."-prefixed
// names get death notifications too.
const DEATH_REGEX = new RegExp(
  String.raw`\[.+?\].*:\s+(${PLAYER_NAME})\s+(was slain|was shot|was killed|drowned|burned|fell|hit the ground|went off with a bang|blew up|was blown up|tried to swim|was impaled|was squished|was pummeled|was fireballed|starved|suffocated|was poked|experienced kinetic|was doomed|walked into|was pricked|died|withered away|was stung|was obliterated|was squashed|didn't want to live|was frozen|was skewered)(.*)$`,
  "i",
);

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

    await broadcastNotification(client, guildConfigs, {
      serverId,
      event: "death",
      logTag: "deaths",
      buildEmbed: (withServerFooter) =>
        createPlayerEmbed(player, {
          title: "☠️ Death",
          description: deathMessage,
          color: 0xff5555,
          ...(withServerFooter ? { footer: { text: serverId } } : {}),
        }),
    });
  });
}
