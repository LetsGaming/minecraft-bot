import { type Client } from "discord.js";
import { createPlayerEmbed } from "../../utils/embedUtils.js";
import type { ILogWatcher } from "../logWatcher.js";
import type { GuildConfig } from "../../types/index.js";
import { broadcastNotification, PLAYER_NAME } from "./notifyGuilds.js";

// B-11/M-01: PLAYER_NAME captures Bedrock names prefixed with "." by
// Geyser/Floodgate in addition to vanilla [a-zA-Z0-9_] names.
const JOIN_REGEX = new RegExp(
  String.raw`\[.+?\].*:\s+(${PLAYER_NAME}) joined the game`,
);
const LEAVE_REGEX = new RegExp(
  String.raw`\[.+?\].*:\s+(${PLAYER_NAME}) left the game`,
);

export function registerJoinLeaveWatcher(
  logWatcher: ILogWatcher,
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): void {
  const serverId = logWatcher.server.id;

  logWatcher.register(JOIN_REGEX, async (match) => {
    await notify(client, guildConfigs, serverId, match[1]!, "join");
  });

  logWatcher.register(LEAVE_REGEX, async (match) => {
    await notify(client, guildConfigs, serverId, match[1]!, "leave");
  });
}

async function notify(
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
  serverId: string,
  player: string,
  event: "join" | "leave",
): Promise<void> {
  const isJoin = event === "join";
  await broadcastNotification(client, guildConfigs, {
    serverId,
    event,
    logTag: "joinLeave",
    buildEmbed: (withServerFooter) =>
      createPlayerEmbed(player, {
        title: isJoin ? "Player Joined" : "Player Left",
        description: `${player} ${isJoin ? "joined" : "left"} the server`,
        color: isJoin ? 0x55ff55 : 0xff5555,
        ...(withServerFooter ? { footer: { text: serverId } } : {}),
      }),
  });
}
