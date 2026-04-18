import { type Client } from "discord.js";
import { log } from "../../utils/logger.js";
import { createEmbed } from "../../utils/embedUtils.js";
import type { ILogWatcher } from "../logWatcher.js";
import type { ServerInstance } from "../../utils/server.js";
import type { GuildConfig } from "../../types/index.js";

const CHAT_REGEX = /\[.+?\]: <(?:\[AFK\]\s*)?([^>]+)>\s+(.+)/;

export function registerChatBridge(
  logWatcher: ILogWatcher,
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): void {
  logWatcher.register(CHAT_REGEX, async (match) => {
    const [, player, message] = match;
    if (!player || !message) return;
    if (message.startsWith("!")) return;

    const serverId = logWatcher.server.id;

    for (const [guildId, gcfg] of Object.entries(guildConfigs)) {
      const bridge = gcfg.chatBridge;
      if (!bridge?.channelId) continue;
      if (bridge.server && bridge.server !== serverId) continue;

      try {
        const channel = await client.channels.fetch(bridge.channelId);
        if (!channel || !("send" in channel)) continue;

        const head = `https://mc-heads.net/avatar/${player}/32`;
        const embed = createEmbed({
          author: { name: player, iconURL: head },
          description: message,
          color: 0x55ff55,
          ...(Object.keys(guildConfigs).length > 1
            ? { footer: { text: serverId } }
            : {}),
        });

        await channel.send({ embeds: [embed] });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("chatBridge", `Failed to send to guild ${guildId}: ${msg}`);
      }
    }
  });
}

/**
 * Set up Discord → Minecraft bridge for a channel.
 */
export function setupDiscordToMc(
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
  getServerInstance: (id: string) => ServerInstance | null,
): void {
  client.on("messageCreate", async (msg) => {
    if (msg.author.bot) return;
    const guildId = msg.guild?.id;
    if (!guildId) return;

    const gcfg = guildConfigs[guildId];
    if (!gcfg?.chatBridge?.channelId) return;
    if (msg.channel.id !== gcfg.chatBridge.channelId) return;

    const serverId = gcfg.chatBridge.server ?? "default";
    const server = getServerInstance(serverId);
    if (!server) return;

    const content = msg.content.replace(/"/g, '\\"').slice(0, 200);
    await server.sendCommand(`/say [${msg.author.displayName}] ${content}`);
  });
}
